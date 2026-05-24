from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Literal, Optional

from agent.model_metadata import fetch_endpoint_model_metadata, fetch_model_metadata
from utils import base_url_host_matches

DEFAULT_PRICING = {"input": 0.0, "output": 0.0}

_ZERO = Decimal("0")
_ONE_MILLION = Decimal("1000000")

CostStatus = Literal["actual", "estimated", "included", "unknown"]
CostSource = Literal[
    "provider_cost_api",
    "provider_generation_api",
    "provider_models_api",
    "official_docs_snapshot",
    "user_override",
    "custom_contract",
    "none",
]


@dataclass(frozen=True)
class CanonicalUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    reasoning_tokens: int = 0
    request_count: int = 1
    raw_usage: Optional[dict[str, Any]] = None

    @property
    def prompt_tokens(self) -> int:
        return self.input_tokens + self.cache_read_tokens + self.cache_write_tokens

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.output_tokens


@dataclass(frozen=True)
class BillingRoute:
    provider: str
    model: str
    base_url: str = ""
    billing_mode: str = "unknown"


@dataclass(frozen=True)
class PricingEntry:
    input_cost_per_million: Optional[Decimal] = None
    output_cost_per_million: Optional[Decimal] = None
    cache_read_cost_per_million: Optional[Decimal] = None
    cache_write_cost_per_million: Optional[Decimal] = None
    request_cost: Optional[Decimal] = None
    source: CostSource = "none"
    source_url: Optional[str] = None
    pricing_version: Optional[str] = None
    fetched_at: Optional[datetime] = None


@dataclass(frozen=True)
class CostResult:
    amount_usd: Optional[Decimal]
    status: CostStatus
    source: CostSource
    label: str
    fetched_at: Optional[datetime] = None
    pricing_version: Optional[str] = None
    notes: tuple[str, ...] = ()


_UTC_NOW = lambda: datetime.now(timezone.utc)
_PRICING_STORE_SCHEMA_VERSION = 1
_PRICING_STORE_REFRESH_SECONDS = 24 * 60 * 60


# Official docs snapshot entries. Models whose published pricing and cache
# semantics are stable enough to encode exactly.
_OFFICIAL_DOCS_PRICING: Dict[tuple[str, str], PricingEntry] = {
    # ── Anthropic Claude 4.7 ─────────────────────────────────────────────
    # Opus 4.5/4.6/4.7 share $5/$25 pricing (new tokenizer, up to 35% more
    # tokens for the same text).
    # Source: https://platform.claude.com/docs/en/about-claude/pricing
    (
        "anthropic",
        "claude-opus-4-7",
    ): PricingEntry(
        input_cost_per_million=Decimal("5.00"),
        output_cost_per_million=Decimal("25.00"),
        cache_read_cost_per_million=Decimal("0.50"),
        cache_write_cost_per_million=Decimal("6.25"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    (
        "anthropic",
        "claude-opus-4-7-20250507",
    ): PricingEntry(
        input_cost_per_million=Decimal("5.00"),
        output_cost_per_million=Decimal("25.00"),
        cache_read_cost_per_million=Decimal("0.50"),
        cache_write_cost_per_million=Decimal("6.25"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    # ── Anthropic Claude 4.6 ─────────────────────────────────────────────
    (
        "anthropic",
        "claude-opus-4-6",
    ): PricingEntry(
        input_cost_per_million=Decimal("5.00"),
        output_cost_per_million=Decimal("25.00"),
        cache_read_cost_per_million=Decimal("0.50"),
        cache_write_cost_per_million=Decimal("6.25"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    (
        "anthropic",
        "claude-opus-4-6-20250414",
    ): PricingEntry(
        input_cost_per_million=Decimal("5.00"),
        output_cost_per_million=Decimal("25.00"),
        cache_read_cost_per_million=Decimal("0.50"),
        cache_write_cost_per_million=Decimal("6.25"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    (
        "anthropic",
        "claude-sonnet-4-6",
    ): PricingEntry(
        input_cost_per_million=Decimal("3.00"),
        output_cost_per_million=Decimal("15.00"),
        cache_read_cost_per_million=Decimal("0.30"),
        cache_write_cost_per_million=Decimal("3.75"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    (
        "anthropic",
        "claude-sonnet-4-6-20250414",
    ): PricingEntry(
        input_cost_per_million=Decimal("3.00"),
        output_cost_per_million=Decimal("15.00"),
        cache_read_cost_per_million=Decimal("0.30"),
        cache_write_cost_per_million=Decimal("3.75"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    # ── Anthropic Claude 4.5 ─────────────────────────────────────────────
    (
        "anthropic",
        "claude-opus-4-5",
    ): PricingEntry(
        input_cost_per_million=Decimal("5.00"),
        output_cost_per_million=Decimal("25.00"),
        cache_read_cost_per_million=Decimal("0.50"),
        cache_write_cost_per_million=Decimal("6.25"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    (
        "anthropic",
        "claude-sonnet-4-5",
    ): PricingEntry(
        input_cost_per_million=Decimal("3.00"),
        output_cost_per_million=Decimal("15.00"),
        cache_read_cost_per_million=Decimal("0.30"),
        cache_write_cost_per_million=Decimal("3.75"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    (
        "anthropic",
        "claude-haiku-4-5",
    ): PricingEntry(
        input_cost_per_million=Decimal("1.00"),
        output_cost_per_million=Decimal("5.00"),
        cache_read_cost_per_million=Decimal("0.10"),
        cache_write_cost_per_million=Decimal("1.25"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    # ── Anthropic Claude 4 / 4.1 ─────────────────────────────────────────
    (
        "anthropic",
        "claude-opus-4-20250514",
    ): PricingEntry(
        input_cost_per_million=Decimal("15.00"),
        output_cost_per_million=Decimal("75.00"),
        cache_read_cost_per_million=Decimal("1.50"),
        cache_write_cost_per_million=Decimal("18.75"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    (
        "anthropic",
        "claude-sonnet-4-20250514",
    ): PricingEntry(
        input_cost_per_million=Decimal("3.00"),
        output_cost_per_million=Decimal("15.00"),
        cache_read_cost_per_million=Decimal("0.30"),
        cache_write_cost_per_million=Decimal("3.75"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    # OpenAI
    (
        "openai",
        "gpt-4o",
    ): PricingEntry(
        input_cost_per_million=Decimal("2.50"),
        output_cost_per_million=Decimal("10.00"),
        cache_read_cost_per_million=Decimal("1.25"),
        source="official_docs_snapshot",
        source_url="https://openai.com/api/pricing/",
        pricing_version="openai-pricing-2026-03-16",
    ),
    (
        "openai",
        "gpt-4o-mini",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.15"),
        output_cost_per_million=Decimal("0.60"),
        cache_read_cost_per_million=Decimal("0.075"),
        source="official_docs_snapshot",
        source_url="https://openai.com/api/pricing/",
        pricing_version="openai-pricing-2026-03-16",
    ),
    (
        "openai",
        "gpt-4.1",
    ): PricingEntry(
        input_cost_per_million=Decimal("2.00"),
        output_cost_per_million=Decimal("8.00"),
        cache_read_cost_per_million=Decimal("0.50"),
        source="official_docs_snapshot",
        source_url="https://openai.com/api/pricing/",
        pricing_version="openai-pricing-2026-03-16",
    ),
    (
        "openai",
        "gpt-4.1-mini",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.40"),
        output_cost_per_million=Decimal("1.60"),
        cache_read_cost_per_million=Decimal("0.10"),
        source="official_docs_snapshot",
        source_url="https://openai.com/api/pricing/",
        pricing_version="openai-pricing-2026-03-16",
    ),
    (
        "openai",
        "gpt-4.1-nano",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.10"),
        output_cost_per_million=Decimal("0.40"),
        cache_read_cost_per_million=Decimal("0.025"),
        source="official_docs_snapshot",
        source_url="https://openai.com/api/pricing/",
        pricing_version="openai-pricing-2026-03-16",
    ),
    (
        "openai",
        "o3",
    ): PricingEntry(
        input_cost_per_million=Decimal("10.00"),
        output_cost_per_million=Decimal("40.00"),
        cache_read_cost_per_million=Decimal("2.50"),
        source="official_docs_snapshot",
        source_url="https://openai.com/api/pricing/",
        pricing_version="openai-pricing-2026-03-16",
    ),
    (
        "openai",
        "o3-mini",
    ): PricingEntry(
        input_cost_per_million=Decimal("1.10"),
        output_cost_per_million=Decimal("4.40"),
        cache_read_cost_per_million=Decimal("0.55"),
        source="official_docs_snapshot",
        source_url="https://openai.com/api/pricing/",
        pricing_version="openai-pricing-2026-03-16",
    ),
    # ── Anthropic older models (pre-4.5 generation) ────────────────────────
    (
        "anthropic",
        "claude-3-5-sonnet-20241022",
    ): PricingEntry(
        input_cost_per_million=Decimal("3.00"),
        output_cost_per_million=Decimal("15.00"),
        cache_read_cost_per_million=Decimal("0.30"),
        cache_write_cost_per_million=Decimal("3.75"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    (
        "anthropic",
        "claude-3-5-haiku-20241022",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.80"),
        output_cost_per_million=Decimal("4.00"),
        cache_read_cost_per_million=Decimal("0.08"),
        cache_write_cost_per_million=Decimal("1.00"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    (
        "anthropic",
        "claude-3-opus-20240229",
    ): PricingEntry(
        input_cost_per_million=Decimal("15.00"),
        output_cost_per_million=Decimal("75.00"),
        cache_read_cost_per_million=Decimal("1.50"),
        cache_write_cost_per_million=Decimal("18.75"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    (
        "anthropic",
        "claude-3-haiku-20240307",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.25"),
        output_cost_per_million=Decimal("1.25"),
        cache_read_cost_per_million=Decimal("0.03"),
        cache_write_cost_per_million=Decimal("0.30"),
        source="official_docs_snapshot",
        source_url="https://platform.claude.com/docs/en/about-claude/pricing",
        pricing_version="anthropic-pricing-2026-05",
    ),
    # DeepSeek
    (
        "deepseek",
        "deepseek-chat",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.14"),
        output_cost_per_million=Decimal("0.28"),
        source="official_docs_snapshot",
        source_url="https://api-docs.deepseek.com/quick_start/pricing",
        pricing_version="deepseek-pricing-2026-03-16",
    ),
    (
        "deepseek",
        "deepseek-reasoner",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.55"),
        output_cost_per_million=Decimal("2.19"),
        source="official_docs_snapshot",
        source_url="https://api-docs.deepseek.com/quick_start/pricing",
        pricing_version="deepseek-pricing-2026-03-16",
    ),
    # Google Gemini
    (
        "google",
        "gemini-2.5-pro",
    ): PricingEntry(
        input_cost_per_million=Decimal("1.25"),
        output_cost_per_million=Decimal("10.00"),
        source="official_docs_snapshot",
        source_url="https://ai.google.dev/pricing",
        pricing_version="google-pricing-2026-03-16",
    ),
    (
        "google",
        "gemini-2.5-flash",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.15"),
        output_cost_per_million=Decimal("0.60"),
        source="official_docs_snapshot",
        source_url="https://ai.google.dev/pricing",
        pricing_version="google-pricing-2026-03-16",
    ),
    (
        "google",
        "gemini-2.0-flash",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.10"),
        output_cost_per_million=Decimal("0.40"),
        source="official_docs_snapshot",
        source_url="https://ai.google.dev/pricing",
        pricing_version="google-pricing-2026-03-16",
    ),
    # AWS Bedrock — pricing per the Bedrock pricing page.
    # Bedrock charges the same per-token rates as the model provider but
    # through AWS billing.  These are the on-demand prices (no commitment).
    # Source: https://aws.amazon.com/bedrock/pricing/
    (
        "bedrock",
        "anthropic.claude-opus-4-6",
    ): PricingEntry(
        input_cost_per_million=Decimal("15.00"),
        output_cost_per_million=Decimal("75.00"),
        source="official_docs_snapshot",
        source_url="https://aws.amazon.com/bedrock/pricing/",
        pricing_version="bedrock-pricing-2026-04",
    ),
    (
        "bedrock",
        "anthropic.claude-sonnet-4-6",
    ): PricingEntry(
        input_cost_per_million=Decimal("3.00"),
        output_cost_per_million=Decimal("15.00"),
        source="official_docs_snapshot",
        source_url="https://aws.amazon.com/bedrock/pricing/",
        pricing_version="bedrock-pricing-2026-04",
    ),
    (
        "bedrock",
        "anthropic.claude-sonnet-4-5",
    ): PricingEntry(
        input_cost_per_million=Decimal("3.00"),
        output_cost_per_million=Decimal("15.00"),
        source="official_docs_snapshot",
        source_url="https://aws.amazon.com/bedrock/pricing/",
        pricing_version="bedrock-pricing-2026-04",
    ),
    (
        "bedrock",
        "anthropic.claude-haiku-4-5",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.80"),
        output_cost_per_million=Decimal("4.00"),
        source="official_docs_snapshot",
        source_url="https://aws.amazon.com/bedrock/pricing/",
        pricing_version="bedrock-pricing-2026-04",
    ),
    (
        "bedrock",
        "amazon.nova-pro",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.80"),
        output_cost_per_million=Decimal("3.20"),
        source="official_docs_snapshot",
        source_url="https://aws.amazon.com/bedrock/pricing/",
        pricing_version="bedrock-pricing-2026-04",
    ),
    (
        "bedrock",
        "amazon.nova-lite",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.06"),
        output_cost_per_million=Decimal("0.24"),
        source="official_docs_snapshot",
        source_url="https://aws.amazon.com/bedrock/pricing/",
        pricing_version="bedrock-pricing-2026-04",
    ),
    (
        "bedrock",
        "amazon.nova-micro",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.035"),
        output_cost_per_million=Decimal("0.14"),
        source="official_docs_snapshot",
        source_url="https://aws.amazon.com/bedrock/pricing/",
        pricing_version="bedrock-pricing-2026-04",
    ),
    # MiniMax
    (
        "minimax",
        "minimax-m2.7",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.30"),
        output_cost_per_million=Decimal("1.20"),
        source="official_docs_snapshot",
        pricing_version="minimax-pricing-2026-04",
    ),
    (
        "minimax-cn",
        "minimax-m2.7",
    ): PricingEntry(
        input_cost_per_million=Decimal("0.30"),
        output_cost_per_million=Decimal("1.20"),
        source="official_docs_snapshot",
        pricing_version="minimax-pricing-2026-04",
    ),
}

# Redou's model picker tracks newer vendor catalogs faster than the old
# snapshot above. Keep these entries source-linked and persist them to the
# user's pricing cache before Redou analytics reads them.
_OFFICIAL_DOCS_PRICING.update(
    {
        # OpenAI API pricing, USD per 1M tokens.
        # Source: https://openai.com/api/pricing/
        ("openai", "gpt-5.5"): PricingEntry(
            input_cost_per_million=Decimal("5.00"),
            output_cost_per_million=Decimal("30.00"),
            cache_read_cost_per_million=Decimal("0.50"),
            source="official_docs_snapshot",
            source_url="https://openai.com/api/pricing/",
            pricing_version="openai-pricing-2026-05-13",
        ),
        ("openai", "gpt-5.4"): PricingEntry(
            input_cost_per_million=Decimal("2.50"),
            output_cost_per_million=Decimal("15.00"),
            cache_read_cost_per_million=Decimal("0.25"),
            source="official_docs_snapshot",
            source_url="https://openai.com/api/pricing/",
            pricing_version="openai-pricing-2026-05-13",
        ),
        ("openai", "gpt-5.4-mini"): PricingEntry(
            input_cost_per_million=Decimal("0.75"),
            output_cost_per_million=Decimal("4.50"),
            cache_read_cost_per_million=Decimal("0.075"),
            source="official_docs_snapshot",
            source_url="https://openai.com/api/pricing/",
            pricing_version="openai-pricing-2026-05-13",
        ),
        ("openai", "gpt-5.4-nano"): PricingEntry(
            input_cost_per_million=Decimal("0.05"),
            output_cost_per_million=Decimal("0.40"),
            cache_read_cost_per_million=Decimal("0.005"),
            source="official_docs_snapshot",
            source_url="https://openai.com/api/pricing/",
            pricing_version="openai-pricing-2026-05-13",
        ),

        # DeepSeek API pricing. The 2026-05-13 snapshot reflects the official
        # discount table that is valid until 2026-05-31.
        # Source: https://api-docs.deepseek.com/quick_start/pricing
        ("deepseek", "deepseek-v4-pro"): PricingEntry(
            input_cost_per_million=Decimal("0.435"),
            output_cost_per_million=Decimal("0.87"),
            cache_read_cost_per_million=Decimal("0.003625"),
            source="official_docs_snapshot",
            source_url="https://api-docs.deepseek.com/quick_start/pricing",
            pricing_version="deepseek-pricing-2026-05-13-discount",
        ),
        ("deepseek", "deepseek-v4-flash"): PricingEntry(
            input_cost_per_million=Decimal("0.14"),
            output_cost_per_million=Decimal("0.28"),
            cache_read_cost_per_million=Decimal("0.0028"),
            source="official_docs_snapshot",
            source_url="https://api-docs.deepseek.com/quick_start/pricing",
            pricing_version="deepseek-pricing-2026-05-13-discount",
        ),
        ("deepseek", "deepseek-chat"): PricingEntry(
            input_cost_per_million=Decimal("0.14"),
            output_cost_per_million=Decimal("0.28"),
            cache_read_cost_per_million=Decimal("0.0028"),
            source="official_docs_snapshot",
            source_url="https://api-docs.deepseek.com/quick_start/pricing",
            pricing_version="deepseek-pricing-2026-05-13-discount",
        ),
        ("deepseek", "deepseek-reasoner"): PricingEntry(
            input_cost_per_million=Decimal("0.14"),
            output_cost_per_million=Decimal("0.28"),
            cache_read_cost_per_million=Decimal("0.0028"),
            source="official_docs_snapshot",
            source_url="https://api-docs.deepseek.com/quick_start/pricing",
            pricing_version="deepseek-pricing-2026-05-13-discount",
        ),

        # Kimi / Moonshot API pricing, USD per 1M tokens.
        # Sources:
        # https://platform.kimi.ai/docs/pricing/chat-k26
        # https://platform.kimi.ai/docs/pricing/chat-k25
        # https://platform.kimi.ai/docs/pricing/chat-k2
        ("kimi-coding", "kimi-k2.6"): PricingEntry(
            input_cost_per_million=Decimal("0.95"),
            output_cost_per_million=Decimal("4.00"),
            cache_read_cost_per_million=Decimal("0.16"),
            source="official_docs_snapshot",
            source_url="https://platform.kimi.ai/docs/pricing/chat-k26",
            pricing_version="kimi-pricing-2026-05-13",
        ),
        ("kimi-coding-cn", "kimi-k2.6"): PricingEntry(
            input_cost_per_million=Decimal("0.95"),
            output_cost_per_million=Decimal("4.00"),
            cache_read_cost_per_million=Decimal("0.16"),
            source="official_docs_snapshot",
            source_url="https://platform.kimi.ai/docs/pricing/chat-k26",
            pricing_version="kimi-pricing-2026-05-13",
        ),
        ("kimi-coding", "kimi-k2.5"): PricingEntry(
            input_cost_per_million=Decimal("0.60"),
            output_cost_per_million=Decimal("3.00"),
            cache_read_cost_per_million=Decimal("0.10"),
            source="official_docs_snapshot",
            source_url="https://platform.kimi.ai/docs/pricing/chat-k25",
            pricing_version="kimi-pricing-2026-05-13",
        ),
        ("kimi-coding-cn", "kimi-k2.5"): PricingEntry(
            input_cost_per_million=Decimal("0.60"),
            output_cost_per_million=Decimal("3.00"),
            cache_read_cost_per_million=Decimal("0.10"),
            source="official_docs_snapshot",
            source_url="https://platform.kimi.ai/docs/pricing/chat-k25",
            pricing_version="kimi-pricing-2026-05-13",
        ),
        ("kimi-coding", "kimi-k2-thinking"): PricingEntry(
            input_cost_per_million=Decimal("0.60"),
            output_cost_per_million=Decimal("2.50"),
            cache_read_cost_per_million=Decimal("0.15"),
            source="official_docs_snapshot",
            source_url="https://platform.kimi.ai/docs/pricing/chat-k2",
            pricing_version="kimi-pricing-2026-05-13",
        ),
        ("kimi-coding-cn", "kimi-k2-thinking"): PricingEntry(
            input_cost_per_million=Decimal("0.60"),
            output_cost_per_million=Decimal("2.50"),
            cache_read_cost_per_million=Decimal("0.15"),
            source="official_docs_snapshot",
            source_url="https://platform.kimi.ai/docs/pricing/chat-k2",
            pricing_version="kimi-pricing-2026-05-13",
        ),
        ("kimi-coding", "kimi-k2-thinking-turbo"): PricingEntry(
            input_cost_per_million=Decimal("1.15"),
            output_cost_per_million=Decimal("8.00"),
            cache_read_cost_per_million=Decimal("0.15"),
            source="official_docs_snapshot",
            source_url="https://platform.kimi.ai/docs/pricing/chat-k2",
            pricing_version="kimi-pricing-2026-05-13",
        ),
        ("kimi-coding-cn", "kimi-k2-thinking-turbo"): PricingEntry(
            input_cost_per_million=Decimal("1.15"),
            output_cost_per_million=Decimal("8.00"),
            cache_read_cost_per_million=Decimal("0.15"),
            source="official_docs_snapshot",
            source_url="https://platform.kimi.ai/docs/pricing/chat-k2",
            pricing_version="kimi-pricing-2026-05-13",
        ),
        ("kimi-coding", "kimi-k2-turbo-preview"): PricingEntry(
            input_cost_per_million=Decimal("1.15"),
            output_cost_per_million=Decimal("8.00"),
            cache_read_cost_per_million=Decimal("0.15"),
            source="official_docs_snapshot",
            source_url="https://platform.kimi.ai/docs/pricing/chat-k2",
            pricing_version="kimi-pricing-2026-05-13",
        ),
        ("kimi-coding-cn", "kimi-k2-turbo-preview"): PricingEntry(
            input_cost_per_million=Decimal("1.15"),
            output_cost_per_million=Decimal("8.00"),
            cache_read_cost_per_million=Decimal("0.15"),
            source="official_docs_snapshot",
            source_url="https://platform.kimi.ai/docs/pricing/chat-k2",
            pricing_version="kimi-pricing-2026-05-13",
        ),
        ("kimi-coding", "kimi-k2-0905-preview"): PricingEntry(
            input_cost_per_million=Decimal("0.60"),
            output_cost_per_million=Decimal("2.50"),
            cache_read_cost_per_million=Decimal("0.15"),
            source="official_docs_snapshot",
            source_url="https://platform.kimi.ai/docs/pricing/chat-k2",
            pricing_version="kimi-pricing-2026-05-13",
        ),
        ("kimi-coding-cn", "kimi-k2-0905-preview"): PricingEntry(
            input_cost_per_million=Decimal("0.60"),
            output_cost_per_million=Decimal("2.50"),
            cache_read_cost_per_million=Decimal("0.15"),
            source="official_docs_snapshot",
            source_url="https://platform.kimi.ai/docs/pricing/chat-k2",
            pricing_version="kimi-pricing-2026-05-13",
        ),

        # Z.AI / GLM pricing, USD per 1M tokens.
        # Source: https://docs.z.ai/guides/overview/pricing
        ("zai", "glm-5.1"): PricingEntry(
            input_cost_per_million=Decimal("1.40"),
            output_cost_per_million=Decimal("4.40"),
            cache_read_cost_per_million=Decimal("0.26"),
            source="official_docs_snapshot",
            source_url="https://docs.z.ai/guides/overview/pricing",
            pricing_version="zai-pricing-2026-05-13",
        ),
        ("zai", "glm-5"): PricingEntry(
            input_cost_per_million=Decimal("1.00"),
            output_cost_per_million=Decimal("3.20"),
            cache_read_cost_per_million=Decimal("0.20"),
            source="official_docs_snapshot",
            source_url="https://docs.z.ai/guides/overview/pricing",
            pricing_version="zai-pricing-2026-05-13",
        ),
        ("zai", "glm-4.7"): PricingEntry(
            input_cost_per_million=Decimal("0.60"),
            output_cost_per_million=Decimal("2.20"),
            cache_read_cost_per_million=Decimal("0.11"),
            source="official_docs_snapshot",
            source_url="https://docs.z.ai/guides/overview/pricing",
            pricing_version="zai-pricing-2026-05-13",
        ),
        ("zai", "glm-4.5"): PricingEntry(
            input_cost_per_million=Decimal("0.60"),
            output_cost_per_million=Decimal("2.20"),
            cache_read_cost_per_million=Decimal("0.11"),
            source="official_docs_snapshot",
            source_url="https://docs.z.ai/guides/overview/pricing",
            pricing_version="zai-pricing-2026-05-13",
        ),
        ("zai", "glm-4.5-flash"): PricingEntry(
            input_cost_per_million=Decimal("0.00"),
            output_cost_per_million=Decimal("0.00"),
            cache_read_cost_per_million=Decimal("0.00"),
            source="official_docs_snapshot",
            source_url="https://docs.z.ai/guides/overview/pricing",
            pricing_version="zai-pricing-2026-05-13",
        ),

        # MiniMax text model pricing, USD per 1M tokens.
        # Source: https://platform.minimax.io/docs/guides/pricing-paygo
        ("minimax", "minimax-m2.7"): PricingEntry(
            input_cost_per_million=Decimal("0.30"),
            output_cost_per_million=Decimal("1.20"),
            cache_read_cost_per_million=Decimal("0.06"),
            cache_write_cost_per_million=Decimal("0.375"),
            source="official_docs_snapshot",
            source_url="https://platform.minimax.io/docs/guides/pricing-paygo",
            pricing_version="minimax-pricing-2026-05-13",
        ),
        ("minimax-cn", "minimax-m2.7"): PricingEntry(
            input_cost_per_million=Decimal("0.30"),
            output_cost_per_million=Decimal("1.20"),
            cache_read_cost_per_million=Decimal("0.06"),
            cache_write_cost_per_million=Decimal("0.375"),
            source="official_docs_snapshot",
            source_url="https://platform.minimax.io/docs/guides/pricing-paygo",
            pricing_version="minimax-pricing-2026-05-13",
        ),
        ("minimax", "minimax-m2.7-highspeed"): PricingEntry(
            input_cost_per_million=Decimal("0.60"),
            output_cost_per_million=Decimal("2.40"),
            cache_read_cost_per_million=Decimal("0.06"),
            cache_write_cost_per_million=Decimal("0.375"),
            source="official_docs_snapshot",
            source_url="https://platform.minimax.io/docs/guides/pricing-paygo",
            pricing_version="minimax-pricing-2026-05-13",
        ),
        ("minimax-cn", "minimax-m2.7-highspeed"): PricingEntry(
            input_cost_per_million=Decimal("0.60"),
            output_cost_per_million=Decimal("2.40"),
            cache_read_cost_per_million=Decimal("0.06"),
            cache_write_cost_per_million=Decimal("0.375"),
            source="official_docs_snapshot",
            source_url="https://platform.minimax.io/docs/guides/pricing-paygo",
            pricing_version="minimax-pricing-2026-05-13",
        ),
        ("minimax", "minimax-m2.5"): PricingEntry(
            input_cost_per_million=Decimal("0.30"),
            output_cost_per_million=Decimal("1.20"),
            cache_read_cost_per_million=Decimal("0.03"),
            cache_write_cost_per_million=Decimal("0.375"),
            source="official_docs_snapshot",
            source_url="https://platform.minimax.io/docs/guides/pricing-paygo",
            pricing_version="minimax-pricing-2026-05-13",
        ),
        ("minimax-cn", "minimax-m2.5"): PricingEntry(
            input_cost_per_million=Decimal("0.30"),
            output_cost_per_million=Decimal("1.20"),
            cache_read_cost_per_million=Decimal("0.03"),
            cache_write_cost_per_million=Decimal("0.375"),
            source="official_docs_snapshot",
            source_url="https://platform.minimax.io/docs/guides/pricing-paygo",
            pricing_version="minimax-pricing-2026-05-13",
        ),
        ("minimax", "minimax-m2.5-highspeed"): PricingEntry(
            input_cost_per_million=Decimal("0.60"),
            output_cost_per_million=Decimal("2.40"),
            cache_read_cost_per_million=Decimal("0.03"),
            cache_write_cost_per_million=Decimal("0.375"),
            source="official_docs_snapshot",
            source_url="https://platform.minimax.io/docs/guides/pricing-paygo",
            pricing_version="minimax-pricing-2026-05-13",
        ),
        ("minimax-cn", "minimax-m2.5-highspeed"): PricingEntry(
            input_cost_per_million=Decimal("0.60"),
            output_cost_per_million=Decimal("2.40"),
            cache_read_cost_per_million=Decimal("0.03"),
            cache_write_cost_per_million=Decimal("0.375"),
            source="official_docs_snapshot",
            source_url="https://platform.minimax.io/docs/guides/pricing-paygo",
            pricing_version="minimax-pricing-2026-05-13",
        ),

        # Alibaba Cloud Model Studio (international), USD per 1M tokens.
        # Source: https://www.alibabacloud.com/help/en/model-studio/model-pricing
        ("alibaba", "qwen3.5-plus"): PricingEntry(
            input_cost_per_million=Decimal("0.40"),
            output_cost_per_million=Decimal("2.40"),
            source="official_docs_snapshot",
            source_url="https://www.alibabacloud.com/help/en/model-studio/model-pricing",
            pricing_version="alibaba-pricing-2026-05-13",
        ),
        ("alibaba", "qwen3-coder-plus"): PricingEntry(
            input_cost_per_million=Decimal("1.00"),
            output_cost_per_million=Decimal("5.00"),
            source="official_docs_snapshot",
            source_url="https://www.alibabacloud.com/help/en/model-studio/model-pricing",
            pricing_version="alibaba-pricing-2026-05-13",
        ),
        ("alibaba", "qwen3-coder-next"): PricingEntry(
            input_cost_per_million=Decimal("1.00"),
            output_cost_per_million=Decimal("5.00"),
            source="official_docs_snapshot",
            source_url="https://www.alibabacloud.com/help/en/model-studio/model-pricing",
            pricing_version="alibaba-pricing-2026-05-13",
        ),

        # Xiaomi MiMo overseas pricing, USD per 1M tokens for the <=256K input
        # tier. Cache writes are listed as limited-time free in the official
        # pricing page.
        # Source: https://platform.xiaomimimo.com/static/docs/pricing.md
        ("xiaomi", "mimo-v2.5-pro"): PricingEntry(
            input_cost_per_million=Decimal("1.00"),
            output_cost_per_million=Decimal("3.00"),
            cache_read_cost_per_million=Decimal("0.20"),
            cache_write_cost_per_million=Decimal("0.00"),
            source="official_docs_snapshot",
            source_url="https://platform.xiaomimimo.com/static/docs/pricing.md",
            pricing_version="xiaomi-pricing-2026-05-13",
        ),
        ("xiaomi", "mimo-v2-pro"): PricingEntry(
            input_cost_per_million=Decimal("1.00"),
            output_cost_per_million=Decimal("3.00"),
            cache_read_cost_per_million=Decimal("0.20"),
            cache_write_cost_per_million=Decimal("0.00"),
            source="official_docs_snapshot",
            source_url="https://platform.xiaomimimo.com/static/docs/pricing.md",
            pricing_version="xiaomi-pricing-2026-05-13",
        ),
        ("xiaomi", "mimo-v2.5"): PricingEntry(
            input_cost_per_million=Decimal("0.40"),
            output_cost_per_million=Decimal("2.00"),
            cache_read_cost_per_million=Decimal("0.08"),
            cache_write_cost_per_million=Decimal("0.00"),
            source="official_docs_snapshot",
            source_url="https://platform.xiaomimimo.com/static/docs/pricing.md",
            pricing_version="xiaomi-pricing-2026-05-13",
        ),
        ("xiaomi", "mimo-v2-omni"): PricingEntry(
            input_cost_per_million=Decimal("0.40"),
            output_cost_per_million=Decimal("2.00"),
            cache_read_cost_per_million=Decimal("0.08"),
            cache_write_cost_per_million=Decimal("0.00"),
            source="official_docs_snapshot",
            source_url="https://platform.xiaomimimo.com/static/docs/pricing.md",
            pricing_version="xiaomi-pricing-2026-05-13",
        ),
        ("xiaomi", "mimo-v2-flash"): PricingEntry(
            input_cost_per_million=Decimal("0.10"),
            output_cost_per_million=Decimal("0.30"),
            cache_read_cost_per_million=Decimal("0.01"),
            cache_write_cost_per_million=Decimal("0.00"),
            source="official_docs_snapshot",
            source_url="https://platform.xiaomimimo.com/static/docs/pricing.md",
            pricing_version="xiaomi-pricing-2026-05-13",
        ),
        ("xiaomi", "mimo-v2.5-tts"): PricingEntry(
            input_cost_per_million=Decimal("0.00"),
            output_cost_per_million=Decimal("0.00"),
            cache_read_cost_per_million=Decimal("0.00"),
            cache_write_cost_per_million=Decimal("0.00"),
            source="official_docs_snapshot",
            source_url="https://platform.xiaomimimo.com/static/docs/pricing.md",
            pricing_version="xiaomi-pricing-2026-05-13-limited-free",
        ),
        ("xiaomi", "mimo-v2.5-tts-voiceclone"): PricingEntry(
            input_cost_per_million=Decimal("0.00"),
            output_cost_per_million=Decimal("0.00"),
            cache_read_cost_per_million=Decimal("0.00"),
            cache_write_cost_per_million=Decimal("0.00"),
            source="official_docs_snapshot",
            source_url="https://platform.xiaomimimo.com/static/docs/pricing.md",
            pricing_version="xiaomi-pricing-2026-05-13-limited-free",
        ),
        ("xiaomi", "mimo-v2.5-tts-voicedesign"): PricingEntry(
            input_cost_per_million=Decimal("0.00"),
            output_cost_per_million=Decimal("0.00"),
            cache_read_cost_per_million=Decimal("0.00"),
            cache_write_cost_per_million=Decimal("0.00"),
            source="official_docs_snapshot",
            source_url="https://platform.xiaomimimo.com/static/docs/pricing.md",
            pricing_version="xiaomi-pricing-2026-05-13-limited-free",
        ),
        ("xiaomi", "mimo-v2-tts"): PricingEntry(
            input_cost_per_million=Decimal("0.00"),
            output_cost_per_million=Decimal("0.00"),
            cache_read_cost_per_million=Decimal("0.00"),
            cache_write_cost_per_million=Decimal("0.00"),
            source="official_docs_snapshot",
            source_url="https://platform.xiaomimimo.com/static/docs/pricing.md",
            pricing_version="xiaomi-pricing-2026-05-13-limited-free",
        ),
    }
)


def _to_decimal(value: Any) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except Exception:
        return 0


def _pricing_store_path():
    from hermes_constants import get_hermes_home

    return get_hermes_home() / "pricing" / "model-pricing.json"


def _pricing_key(provider: str, model: str) -> str:
    return f"{(provider or '').strip().lower()}:{(model or '').strip().lower()}"


def _datetime_from_iso(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        return None


def _pricing_entry_to_record(entry: PricingEntry) -> Dict[str, Any]:
    def _decimal_to_str(value: Optional[Decimal]) -> Optional[str]:
        return str(value) if value is not None else None

    return {
        "input_cost_per_million": _decimal_to_str(entry.input_cost_per_million),
        "output_cost_per_million": _decimal_to_str(entry.output_cost_per_million),
        "cache_read_cost_per_million": _decimal_to_str(entry.cache_read_cost_per_million),
        "cache_write_cost_per_million": _decimal_to_str(entry.cache_write_cost_per_million),
        "request_cost": _decimal_to_str(entry.request_cost),
        "source": entry.source,
        "source_url": entry.source_url,
        "pricing_version": entry.pricing_version,
        "fetched_at": entry.fetched_at.isoformat() if entry.fetched_at else None,
    }


def _pricing_entry_from_record(record: Dict[str, Any]) -> Optional[PricingEntry]:
    if not isinstance(record, dict):
        return None
    source = str(record.get("source") or "none")
    if source not in {
        "provider_cost_api",
        "provider_generation_api",
        "provider_models_api",
        "official_docs_snapshot",
        "user_override",
        "custom_contract",
        "none",
    }:
        source = "none"
    return PricingEntry(
        input_cost_per_million=_to_decimal(record.get("input_cost_per_million")),
        output_cost_per_million=_to_decimal(record.get("output_cost_per_million")),
        cache_read_cost_per_million=_to_decimal(record.get("cache_read_cost_per_million")),
        cache_write_cost_per_million=_to_decimal(record.get("cache_write_cost_per_million")),
        request_cost=_to_decimal(record.get("request_cost")),
        source=source,  # type: ignore[arg-type]
        source_url=str(record.get("source_url") or "") or None,
        pricing_version=str(record.get("pricing_version") or "") or None,
        fetched_at=_datetime_from_iso(record.get("fetched_at")),
    )


def _load_pricing_store() -> Dict[str, Any]:
    path = _pricing_store_path()
    try:
        if not path.exists():
            return {"schema_version": _PRICING_STORE_SCHEMA_VERSION, "entries": {}}
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return {"schema_version": _PRICING_STORE_SCHEMA_VERSION, "entries": {}}
        entries = payload.get("entries")
        if not isinstance(entries, dict):
            payload["entries"] = {}
        return payload
    except Exception:
        return {"schema_version": _PRICING_STORE_SCHEMA_VERSION, "entries": {}}


def _write_pricing_store(payload: Dict[str, Any]) -> None:
    path = _pricing_store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _store_is_fresh(payload: Dict[str, Any]) -> bool:
    updated_at = _datetime_from_iso(payload.get("live_updated_at"))
    if updated_at is None:
        return False
    return (time.time() - updated_at.timestamp()) < _PRICING_STORE_REFRESH_SECONDS


def _put_pricing_record(
    entries: Dict[str, Any],
    provider: str,
    model: str,
    entry: PricingEntry,
) -> None:
    key = _pricing_key(provider, model)
    if key == ":":
        return
    record = _pricing_entry_to_record(entry)
    record["provider"] = (provider or "").strip().lower()
    record["model"] = (model or "").strip()
    entries[key] = record


def _lookup_persisted_pricing(route: BillingRoute) -> Optional[PricingEntry]:
    payload = _load_pricing_store()
    entries = payload.get("entries") if isinstance(payload, dict) else {}
    if not isinstance(entries, dict):
        return None
    record = entries.get(_pricing_key(route.provider, route.model))
    if record is None and route.provider == "anthropic":
        record = entries.get(_pricing_key(route.provider, _normalize_anthropic_model_name(route.model)))
    if not isinstance(record, dict):
        return None
    return _pricing_entry_from_record(record)


def _cache_pricing_entry(provider: str, model: str, entry: Optional[PricingEntry]) -> None:
    if entry is None:
        return
    try:
        payload = _load_pricing_store()
        entries = payload.setdefault("entries", {})
        if not isinstance(entries, dict):
            entries = {}
            payload["entries"] = entries
        _put_pricing_record(entries, provider, model, entry)
        payload["schema_version"] = _PRICING_STORE_SCHEMA_VERSION
        payload["updated_at"] = _UTC_NOW().isoformat()
        _write_pricing_store(payload)
    except Exception:
        pass


def refresh_pricing_store(*, force_refresh: bool = False, include_live: bool = True) -> Dict[str, Any]:
    """Refresh the local model pricing cache.

    The cache lives under HERMES_HOME so Redou Desktop can calculate analytics
    without scraping pricing pages on every render. Official docs snapshots are
    always merged; live OpenRouter-compatible pricing is refreshed daily.
    """
    payload = _load_pricing_store()
    entries = payload.setdefault("entries", {})
    if not isinstance(entries, dict):
        entries = {}
        payload["entries"] = entries

    for (provider, model), entry in _OFFICIAL_DOCS_PRICING.items():
        _put_pricing_record(entries, provider, model, entry)

    if include_live and (force_refresh or not _store_is_fresh(payload)):
        try:
            metadata = fetch_model_metadata(force_refresh=force_refresh)
            for model_id in metadata.keys():
                entry = _pricing_entry_from_metadata(
                    metadata,
                    model_id,
                    source_url="https://openrouter.ai/docs/api-reference/models/get-models",
                    pricing_version="openrouter-models-api",
                )
                if entry:
                    _put_pricing_record(entries, "openrouter", model_id, entry)
            payload["live_updated_at"] = _UTC_NOW().isoformat()
        except Exception:
            pass

    payload["schema_version"] = _PRICING_STORE_SCHEMA_VERSION
    payload["updated_at"] = _UTC_NOW().isoformat()
    try:
        _write_pricing_store(payload)
    except Exception:
        pass
    return payload


def resolve_billing_route(
    model_name: str,
    provider: Optional[str] = None,
    base_url: Optional[str] = None,
) -> BillingRoute:
    provider_name = (provider or "").strip().lower()
    base = (base_url or "").strip().lower()
    model = (model_name or "").strip()
    if not provider_name and "/" in model:
        inferred_provider, bare_model = model.split("/", 1)
        provider_map = {
            "anthropic": "anthropic",
            "openai": "openai",
            "google": "google",
            "gemini": "google",
            "deepseek": "deepseek",
            "moonshotai": "kimi-coding",
            "kimi": "kimi-coding",
            "minimax": "minimax",
            "qwen": "alibaba",
            "alibaba": "alibaba",
            "z-ai": "zai",
            "zai": "zai",
            "z.ai": "zai",
            "xiaomi": "xiaomi",
        }
        if inferred_provider in provider_map:
            provider_name = provider_map[inferred_provider]
            model = bare_model

    if provider_name == "openai-codex":
        return BillingRoute(provider="openai-codex", model=model, base_url=base_url or "", billing_mode="subscription_included")
    if provider_name == "openrouter" or base_url_host_matches(base_url or "", "openrouter.ai"):
        return BillingRoute(provider="openrouter", model=model, base_url=base_url or "", billing_mode="official_models_api")
    if provider_name == "anthropic":
        return BillingRoute(provider="anthropic", model=model.split("/")[-1], base_url=base_url or "", billing_mode="official_docs_snapshot")
    if provider_name == "openai":
        return BillingRoute(provider="openai", model=model.split("/")[-1], base_url=base_url or "", billing_mode="official_docs_snapshot")
    if provider_name in {"minimax", "minimax-cn", "minimax-oauth"}:
        resolved_provider = "minimax" if provider_name == "minimax-oauth" else provider_name
        return BillingRoute(provider=resolved_provider, model=model.split("/")[-1].lower(), base_url=base_url or "", billing_mode="official_docs_snapshot")
    if provider_name in {"deepseek", "zai", "glm", "kimi-coding", "kimi-coding-cn", "moonshot", "alibaba", "google", "xiaomi"}:
        resolved_provider = {
            "glm": "zai",
            "moonshot": "kimi-coding",
        }.get(provider_name, provider_name)
        return BillingRoute(provider=resolved_provider, model=model.split("/")[-1].lower(), base_url=base_url or "", billing_mode="official_docs_snapshot")
    if provider_name in {"custom", "local"} or (base and "localhost" in base):
        return BillingRoute(provider=provider_name or "custom", model=model, base_url=base_url or "", billing_mode="unknown")
    return BillingRoute(provider=provider_name or "unknown", model=model.split("/")[-1] if model else "", base_url=base_url or "", billing_mode="unknown")


def _normalize_anthropic_model_name(model: str) -> str:
    """Normalize Anthropic model name variants to canonical form.

    Handles:
      - Dot notation: claude-opus-4.7 → claude-opus-4-7
      - Short aliases: claude-opus-4.7 → claude-opus-4-7
      - Strips anthropic/ prefix if present
    """
    name = model.lower().strip()
    if name.startswith("anthropic/"):
        name = name[len("anthropic/"):]
    # Normalize dots to dashes in version numbers (e.g. 4.7 → 4-7, 4.6 → 4-6)
    # But preserve the rest of the name structure
    name = re.sub(r"(\d+)\.(\d+)", r"\1-\2", name)
    return name


def _lookup_official_docs_pricing(route: BillingRoute) -> Optional[PricingEntry]:
    model = route.model.lower()
    # Direct lookup first
    entry = _OFFICIAL_DOCS_PRICING.get((route.provider, model))
    if entry:
        return entry
    # Try normalized name for Anthropic (handles dot-notation like opus-4.7)
    if route.provider == "anthropic":
        normalized = _normalize_anthropic_model_name(model)
        if normalized != model:
            entry = _OFFICIAL_DOCS_PRICING.get((route.provider, normalized))
            if entry:
                return entry
    return None


def _openrouter_pricing_entry(route: BillingRoute) -> Optional[PricingEntry]:
    return _pricing_entry_from_metadata(
        fetch_model_metadata(),
        route.model,
        source_url="https://openrouter.ai/docs/api-reference/models/get-models",
        pricing_version="openrouter-models-api",
    )


def _pricing_entry_from_metadata(
    metadata: Dict[str, Dict[str, Any]],
    model_id: str,
    *,
    source_url: str,
    pricing_version: str,
) -> Optional[PricingEntry]:
    if model_id not in metadata:
        return None
    pricing = metadata[model_id].get("pricing") or {}
    prompt = _to_decimal(pricing.get("prompt"))
    completion = _to_decimal(pricing.get("completion"))
    request = _to_decimal(pricing.get("request"))
    cache_read = _to_decimal(
        pricing.get("cache_read")
        or pricing.get("cached_prompt")
        or pricing.get("input_cache_read")
    )
    cache_write = _to_decimal(
        pricing.get("cache_write")
        or pricing.get("cache_creation")
        or pricing.get("input_cache_write")
    )
    if prompt is None and completion is None and request is None:
        return None

    def _per_token_to_per_million(value: Optional[Decimal]) -> Optional[Decimal]:
        if value is None:
            return None
        return value * _ONE_MILLION

    return PricingEntry(
        input_cost_per_million=_per_token_to_per_million(prompt),
        output_cost_per_million=_per_token_to_per_million(completion),
        cache_read_cost_per_million=_per_token_to_per_million(cache_read),
        cache_write_cost_per_million=_per_token_to_per_million(cache_write),
        request_cost=request,
        source="provider_models_api",
        source_url=source_url,
        pricing_version=pricing_version,
        fetched_at=_UTC_NOW(),
    )


def get_pricing_entry(
    model_name: str,
    provider: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> Optional[PricingEntry]:
    route = resolve_billing_route(model_name, provider=provider, base_url=base_url)
    if route.billing_mode == "subscription_included":
        return PricingEntry(
            input_cost_per_million=_ZERO,
            output_cost_per_million=_ZERO,
            cache_read_cost_per_million=_ZERO,
            cache_write_cost_per_million=_ZERO,
            source="none",
            pricing_version="included-route",
        )
    if route.provider == "openrouter":
        persisted = _lookup_persisted_pricing(route)
        if persisted:
            return persisted
        entry = _openrouter_pricing_entry(route)
        _cache_pricing_entry(route.provider, route.model, entry)
        return entry
    if route.base_url:
        entry = _pricing_entry_from_metadata(
            fetch_endpoint_model_metadata(route.base_url, api_key=api_key or ""),
            route.model,
            source_url=f"{route.base_url.rstrip('/')}/models",
            pricing_version="openai-compatible-models-api",
        )
        if entry:
            _cache_pricing_entry(route.provider, route.model, entry)
            return entry
    entry = _lookup_persisted_pricing(route)
    if entry:
        return entry
    entry = _lookup_official_docs_pricing(route)
    _cache_pricing_entry(route.provider, route.model, entry)
    return entry


def normalize_usage(
    response_usage: Any,
    *,
    provider: Optional[str] = None,
    api_mode: Optional[str] = None,
) -> CanonicalUsage:
    """Normalize raw API response usage into canonical token buckets.

    Handles three API shapes:
    - Anthropic: input_tokens/output_tokens/cache_read_input_tokens/cache_creation_input_tokens
    - Codex Responses: input_tokens includes cache tokens; input_tokens_details.cached_tokens separates them
    - OpenAI Chat Completions: prompt_tokens includes cache tokens; prompt_tokens_details.cached_tokens separates them

    In both Codex and OpenAI modes, input_tokens is derived by subtracting cache
    tokens from the total — the API contract is that input/prompt totals include
    cached tokens and the details object breaks them out.
    """
    if not response_usage:
        return CanonicalUsage()

    provider_name = (provider or "").strip().lower()
    mode = (api_mode or "").strip().lower()

    if mode == "anthropic_messages" or provider_name == "anthropic":
        input_tokens = _to_int(getattr(response_usage, "input_tokens", 0))
        output_tokens = _to_int(getattr(response_usage, "output_tokens", 0))
        cache_read_tokens = _to_int(getattr(response_usage, "cache_read_input_tokens", 0))
        cache_write_tokens = _to_int(getattr(response_usage, "cache_creation_input_tokens", 0))
    elif mode == "codex_responses":
        input_total = _to_int(getattr(response_usage, "input_tokens", 0))
        output_tokens = _to_int(getattr(response_usage, "output_tokens", 0))
        details = getattr(response_usage, "input_tokens_details", None)
        cache_read_tokens = _to_int(getattr(details, "cached_tokens", 0) if details else 0)
        cache_write_tokens = _to_int(
            getattr(details, "cache_creation_tokens", 0) if details else 0
        )
        input_tokens = max(0, input_total - cache_read_tokens - cache_write_tokens)
    else:
        prompt_total = _to_int(getattr(response_usage, "prompt_tokens", 0))
        output_tokens = _to_int(getattr(response_usage, "completion_tokens", 0))
        details = getattr(response_usage, "prompt_tokens_details", None)
        # Primary: OpenAI-style prompt_tokens_details. Fallback: Anthropic-style
        # top-level fields that some OpenAI-compatible proxies (OpenRouter, Vercel
        # AI Gateway, Cline) expose when routing Claude models — without this
        # fallback, cache writes are undercounted as 0 and cache reads can be
        # missed when the proxy only surfaces them at the top level.
        # Port of cline/cline#10266.
        cache_read_tokens = _to_int(getattr(details, "cached_tokens", 0) if details else 0)
        if not cache_read_tokens:
            cache_read_tokens = _to_int(getattr(response_usage, "cache_read_input_tokens", 0))
        cache_write_tokens = _to_int(
            getattr(details, "cache_write_tokens", 0) if details else 0
        )
        if not cache_write_tokens:
            cache_write_tokens = _to_int(
                getattr(response_usage, "cache_creation_input_tokens", 0)
            )
        input_tokens = max(0, prompt_total - cache_read_tokens - cache_write_tokens)

    reasoning_tokens = 0
    output_details = getattr(response_usage, "output_tokens_details", None)
    if output_details:
        reasoning_tokens = _to_int(getattr(output_details, "reasoning_tokens", 0))

    return CanonicalUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cache_read_tokens,
        cache_write_tokens=cache_write_tokens,
        reasoning_tokens=reasoning_tokens,
    )


def estimate_usage_cost(
    model_name: str,
    usage: CanonicalUsage,
    *,
    provider: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> CostResult:
    route = resolve_billing_route(model_name, provider=provider, base_url=base_url)
    if route.billing_mode == "subscription_included":
        return CostResult(
            amount_usd=_ZERO,
            status="included",
            source="none",
            label="included",
            pricing_version="included-route",
        )

    entry = get_pricing_entry(model_name, provider=provider, base_url=base_url, api_key=api_key)
    if not entry:
        return CostResult(amount_usd=None, status="unknown", source="none", label="n/a")

    notes: list[str] = []
    amount = _ZERO

    if usage.input_tokens and entry.input_cost_per_million is None:
        return CostResult(amount_usd=None, status="unknown", source=entry.source, label="n/a")
    if usage.output_tokens and entry.output_cost_per_million is None:
        return CostResult(amount_usd=None, status="unknown", source=entry.source, label="n/a")
    if usage.cache_read_tokens:
        if entry.cache_read_cost_per_million is None:
            return CostResult(
                amount_usd=None,
                status="unknown",
                source=entry.source,
                label="n/a",
                notes=("cache-read pricing unavailable for route",),
            )
    if usage.cache_write_tokens:
        if entry.cache_write_cost_per_million is None:
            return CostResult(
                amount_usd=None,
                status="unknown",
                source=entry.source,
                label="n/a",
                notes=("cache-write pricing unavailable for route",),
            )

    if entry.input_cost_per_million is not None:
        amount += Decimal(usage.input_tokens) * entry.input_cost_per_million / _ONE_MILLION
    if entry.output_cost_per_million is not None:
        amount += Decimal(usage.output_tokens) * entry.output_cost_per_million / _ONE_MILLION
    if entry.cache_read_cost_per_million is not None:
        amount += Decimal(usage.cache_read_tokens) * entry.cache_read_cost_per_million / _ONE_MILLION
    if entry.cache_write_cost_per_million is not None:
        amount += Decimal(usage.cache_write_tokens) * entry.cache_write_cost_per_million / _ONE_MILLION
    if entry.request_cost is not None and usage.request_count:
        amount += Decimal(usage.request_count) * entry.request_cost

    status: CostStatus = "estimated"
    label = f"~${amount:.2f}"
    if entry.source == "none" and amount == _ZERO:
        status = "included"
        label = "included"

    if route.provider == "openrouter":
        notes.append("OpenRouter cost is estimated from the models API until reconciled.")

    return CostResult(
        amount_usd=amount,
        status=status,
        source=entry.source,
        label=label,
        fetched_at=entry.fetched_at,
        pricing_version=entry.pricing_version,
        notes=tuple(notes),
    )


def has_known_pricing(
    model_name: str,
    provider: Optional[str] = None,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> bool:
    """Check whether we have pricing data for this model+route.

    Uses direct lookup instead of routing through the full estimation
    pipeline — avoids creating dummy usage objects just to check status.
    """
    route = resolve_billing_route(model_name, provider=provider, base_url=base_url)
    if route.billing_mode == "subscription_included":
        return True
    entry = get_pricing_entry(model_name, provider=provider, base_url=base_url, api_key=api_key)
    return entry is not None



def format_duration_compact(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    minutes = seconds / 60
    if minutes < 60:
        return f"{minutes:.0f}m"
    hours = minutes / 60
    if hours < 24:
        remaining_min = int(minutes % 60)
        return f"{int(hours)}h {remaining_min}m" if remaining_min else f"{int(hours)}h"
    days = hours / 24
    return f"{days:.1f}d"


def format_token_count_compact(value: int) -> str:
    abs_value = abs(int(value))
    if abs_value < 1_000:
        return str(int(value))

    sign = "-" if value < 0 else ""
    units = ((1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K"))
    for threshold, suffix in units:
        if abs_value >= threshold:
            scaled = abs_value / threshold
            if scaled < 10:
                text = f"{scaled:.2f}"
            elif scaled < 100:
                text = f"{scaled:.1f}"
            else:
                text = f"{scaled:.0f}"
            if "." in text:
                text = text.rstrip("0").rstrip(".")
            return f"{sign}{text}{suffix}"

    return f"{value:,}"
