!macro customHeader
!macroend

!ifndef BUILD_UNINSTALLER
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "MUI2.nsh"

Var RedouPrereqPage
Var RedouPrereqMissingCode
Var RedouPrereqInstallRequired
Var RedouPrereqStatusText

!macro customPageAfterChangeDir
  PageEx custom
    PageCallbacks RedouPrereqPagePre RedouPrereqPageLeave
    Caption "Environment Check"
  PageExEnd
!macroend

Function RedouPrereqWriteScript
  InitPluginsDir
  IfFileExists "$PLUGINSDIR\redou-install-prerequisites.ps1" done
  File "/oname=$PLUGINSDIR\redou-install-prerequisites.ps1" "${BUILD_RESOURCES_DIR}\install-prerequisites.ps1"
done:
FunctionEnd

Function RedouPrereqCheck
  Call RedouPrereqWriteScript
  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\redou-install-prerequisites.ps1" -Check'
  Pop $RedouPrereqMissingCode
  Pop $RedouPrereqStatusText
FunctionEnd

Function RedouPrereqPagePre
  Call RedouPrereqCheck
  StrCpy $RedouPrereqInstallRequired "0"

  !insertmacro MUI_HEADER_TEXT "Environment Check" "Redou Agent checks runtime dependencies before installation."

  nsDialogs::Create 1018
  Pop $RedouPrereqPage
  ${If} $RedouPrereqPage == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0u 0u 100% 72u "$RedouPrereqStatusText"
  Pop $0

  ${If} $RedouPrereqMissingCode == "0"
    ${NSD_CreateLabel} 0u 82u 100% 28u "All required runtime dependencies are available. Click Next to continue."
  ${Else}
    ${NSD_CreateLabel} 0u 82u 100% 48u "Click Next to install missing dependencies automatically with winget. Internet access may be required."
  ${EndIf}
  Pop $0

  nsDialogs::Show
FunctionEnd

Function RedouPrereqPageLeave
  ${If} $RedouPrereqMissingCode == "0"
    StrCpy $RedouPrereqInstallRequired "0"
    Return
  ${EndIf}

  MessageBox MB_OKCANCEL|MB_ICONINFORMATION "Redou Agent will now install the missing runtime dependencies. This may take several minutes." IDOK install IDCANCEL cancel

install:
  StrCpy $RedouPrereqInstallRequired "1"
  Return

cancel:
  Abort
FunctionEnd

Function RedouPrereqInstallMissing
  ${If} $RedouPrereqInstallRequired != "1"
    Return
  ${EndIf}

  Call RedouPrereqWriteScript
  SetDetailsView show
  SetDetailsPrint both
  DetailPrint "Installing missing runtime dependencies. This may take several minutes."

retry:
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\redou-install-prerequisites.ps1" -Install'
  Pop $0
  ${If} $0 == "0"
    DetailPrint "Runtime dependencies are ready."
    Return
  ${EndIf}

  MessageBox MB_RETRYCANCEL|MB_ICONSTOP "Automatic dependency installation failed with code $0.$\r$\n$\r$\nSee the details log above for dependency output." IDRETRY retry IDCANCEL cancel

cancel:
  Abort "Redou Agent dependency installation failed."
FunctionEnd

!macro customInstall
  Call RedouPrereqInstallMissing
!macroend
!endif
