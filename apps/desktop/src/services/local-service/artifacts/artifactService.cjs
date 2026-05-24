const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const TASK_UPLOADS_DIR = "uploads";
const MAX_ATTACHMENT_BYTES = 256 * 1024 * 1024;

function simpleMimeType(file) {
  const ext = path.extname(file || "").toLowerCase();
  const map = {
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".txt": "text/plain",
    ".webp": "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

class ArtifactService {
  constructor({ repos, helpers = {}, logger = null } = {}) {
    if (!repos?.artifacts) {
      throw new Error("ArtifactService requires an artifact repository.");
    }
    if (typeof helpers.findProjectAndTask !== "function") {
      throw new Error("ArtifactService requires findProjectAndTask helper.");
    }
    this.repos = repos;
    this.helpers = helpers;
    this.log = typeof logger === "function" ? logger : () => {};
  }

  helper(name, fallback = null) {
    const value = this.helpers[name];
    return typeof value === "function" ? value : fallback;
  }

  compact(value, max = 300) {
    const compact = this.helper("compact");
    if (compact) return compact(value, max);
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > max ? text.slice(0, max).trimEnd() : text;
  }

  isoNow() {
    const isoNow = this.helper("isoNow");
    return isoNow ? isoNow() : new Date().toISOString();
  }

  redact(value) {
    const redact = this.helper("redact");
    return redact ? redact(value) : String(value || "");
  }

  safeSegment(value, fallback) {
    const safeSegment = this.helper("safeSegment");
    if (safeSegment) return safeSegment(value, fallback);
    const clean = String(value || "")
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 96)
      .toLowerCase();
    return clean || fallback;
  }

  safeAttachmentName(name, fallback = "attachment") {
    const parsed = path.parse(String(name || fallback));
    const base = this.safeSegment(parsed.name, fallback).slice(0, 80);
    const ext = parsed.ext.replace(/[^A-Za-z0-9.]/g, "").slice(0, 16).toLowerCase();
    return `${base || fallback}${ext}`;
  }

  normalizeAttachmentRecord(record, uploadsPath) {
    if (!record || typeof record !== "object") return null;
    const storedPath = String(record.storedPath || record.path || "").trim();
    const name = this.compact(record.name || path.basename(storedPath), 180);
    if (!name) return null;

    // User input attachments are files copied into a task's uploads directory.
    // Task output artifacts are still inferred from task events/messages by the UI.
    const attachment = {
      id: this.compact(record.id || crypto.randomUUID(), 80),
      name,
      storedPath,
      relativePath: this.compact(record.relativePath || (storedPath ? path.relative(uploadsPath, storedPath) : ""), 500),
      size: Number.isFinite(Number(record.size)) ? Number(record.size) : 0,
      mimeType: this.compact(record.mimeType || simpleMimeType(name), 120),
      createdAt: record.createdAt || this.isoNow(),
      metadata: record.metadata && typeof record.metadata === "object" ? record.metadata : {},
    };
    if (record.originalPath) {
      attachment.originalPath = String(record.originalPath);
    }
    return attachment;
  }

  copyTaskAttachments(projectId, taskId, filePaths = []) {
    const { project, task } = this.helpers.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");

    const attachments = [];
    const warnings = [];
    this.repos.artifacts.ensureDirectory(task.uploadsPath);

    for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
      const source = String(filePath || "").trim();
      if (!source) continue;
      try {
        const stat = fs.statSync(source);
        if (!stat.isFile()) {
          warnings.push(`${source}: not a file`);
          continue;
        }
        if (stat.size > MAX_ATTACHMENT_BYTES) {
          warnings.push(`${source}: skipped because it is larger than ${MAX_ATTACHMENT_BYTES} bytes`);
          continue;
        }
        const id = crypto.randomUUID();
        const fileName = `${Date.now()}-${id.slice(0, 8)}-${this.safeAttachmentName(path.basename(source))}`;
        const storedPath = path.join(task.uploadsPath, fileName);
        this.repos.artifacts.copyFileAtomic(source, storedPath);
        attachments.push({
          id,
          name: path.basename(source),
          originalPath: source,
          storedPath,
          relativePath: path.join(TASK_UPLOADS_DIR, fileName),
          size: stat.size,
          mimeType: simpleMimeType(source),
          createdAt: this.isoNow(),
          metadata: {
            parserStatus: "stored",
            parserTodo: "Image, PDF, Word and Excel content extraction is intentionally deferred.",
          },
        });
      } catch (error) {
        warnings.push(`${source}: ${error.message}`);
      }
    }

    if (warnings.length > 0) {
      this.log(`redou attachments warning projectId=${projectId} taskId=${taskId} warnings=${warnings.length}`);
    }
    this.log(`redou attachments copied projectId=${projectId} taskId=${taskId} uploadsPath=${this.redact(task.uploadsPath)} count=${attachments.length}`);
    return { ok: true, projectId, taskId, uploadsPath: task.uploadsPath, attachments, warnings };
  }

  copyTaskAttachmentBuffers(projectId, taskId, files = []) {
    const { project, task } = this.helpers.findProjectAndTask(projectId, taskId);
    if (!project || !task) throw new Error("Project or task not found");

    const attachments = [];
    const warnings = [];
    this.repos.artifacts.ensureDirectory(task.uploadsPath);

    for (const item of Array.isArray(files) ? files : []) {
      const label = this.compact(item?.name || "clipboard image", 180);
      const data = Buffer.isBuffer(item?.data) ? item.data : Buffer.from(item?.data || []);
      if (data.length === 0) {
        warnings.push(`${label}: skipped because it is empty`);
        continue;
      }
      if (data.length > MAX_ATTACHMENT_BYTES) {
        warnings.push(`${label}: skipped because it is larger than ${MAX_ATTACHMENT_BYTES} bytes`);
        continue;
      }
      try {
        const id = crypto.randomUUID();
        const name = label || "clipboard-image.png";
        const fileName = `${Date.now()}-${id.slice(0, 8)}-${this.safeAttachmentName(name, "attachment.png")}`;
        const storedPath = path.join(task.uploadsPath, fileName);
        const tmp = `${storedPath}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, storedPath);
        attachments.push({
          id,
          name,
          ...(item?.originalPath ? { originalPath: String(item.originalPath) } : {}),
          storedPath,
          relativePath: path.join(TASK_UPLOADS_DIR, fileName),
          size: data.length,
          mimeType: this.compact(item?.mimeType || simpleMimeType(name), 120),
          createdAt: this.isoNow(),
          metadata: {
            parserStatus: "stored",
            parserTodo: "Image, PDF, Word and Excel content extraction is intentionally deferred.",
            ...(item?.metadata && typeof item.metadata === "object" ? item.metadata : {}),
          },
        });
      } catch (error) {
        warnings.push(`${label}: ${error.message}`);
      }
    }

    if (warnings.length > 0) {
      this.log(`redou attachment buffers warning projectId=${projectId} taskId=${taskId} warnings=${warnings.length}`);
    }
    this.log(`redou attachment buffers copied projectId=${projectId} taskId=${taskId} uploadsPath=${this.redact(task.uploadsPath)} count=${attachments.length}`);
    return { ok: true, projectId, taskId, uploadsPath: task.uploadsPath, attachments, warnings };
  }
}

module.exports = {
  ArtifactService,
  MAX_ATTACHMENT_BYTES,
  TASK_UPLOADS_DIR,
  simpleMimeType,
};
