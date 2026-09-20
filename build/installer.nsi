; cronkit Windows 首次安装包。
; 安装内容是 versionedDir 布局（稳定 launcher + active.json + versions/），
; 与 dist/cronkit-*-win-x64.zip 同源，安装后可走 relkit 自动更新。
;
; 由 scripts/package-versioned.mjs 调用，必须传入：
;   /DVERSION=x.y.z+N
;   /DVERSION_FOUR=x.y.z.N   （PE 版本资源，无加号）
;   /DSRCDIR=<versioned 目录绝对路径>
;   /DOUTFILE=<setup.exe 绝对路径>
;   /DICONFILE=<可选 .ico 绝对路径>

!ifndef VERSION
  !error "缺少 /DVERSION="
!endif
!ifndef VERSION_FOUR
  !error "缺少 /DVERSION_FOUR="
!endif
!ifndef SRCDIR
  !error "缺少 /DSRCDIR="
!endif
!ifndef OUTFILE
  !error "缺少 /DOUTFILE="
!endif

Unicode True
ManifestDPIAware True

!define PRODUCT_NAME "工作目录编排器"
!define PRODUCT_ID "cronkit"
!define EXE_NAME "WorkspaceOrchestrator.exe"
!define PUBLISHER "AgentsHelpMe"

Name "${PRODUCT_NAME}"
OutFile "${OUTFILE}"
; 按用户安装：relkit-updater 不做 UAC 提权，装进 Program Files 后
; 托盘程序就没有写 versions/ 的权限，内部更新只会以「安装根不可写」告败。
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT_ID}"
InstallDirRegKey HKCU "Software\${PRODUCT_ID}" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show
ShowUnInstDetails show

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"

!define MUI_ABORTWARNING
!ifdef ICONFILE
  !define MUI_ICON "${ICONFILE}"
  !define MUI_UNICON "${ICONFILE}"
!endif

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

VIProductVersion "${VERSION_FOUR}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "FileDescription" "${PRODUCT_NAME} 安装程序"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileDescription" "${PRODUCT_NAME} Setup"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_SIMPCHINESE} "LegalCopyright" "Copyright (C) ${PUBLISHER}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "LegalCopyright" "Copyright (C) ${PUBLISHER}"

Var StartMenuFolder

!macro AssertAppNotRunning
  nsExec::ExecToStack 'cmd /c tasklist /FI "IMAGENAME eq ${EXE_NAME}" /FO CSV /NH | find /I "${EXE_NAME}" >nul'
  Pop $0
  ${If} $0 == 0
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "${PRODUCT_NAME} 正在运行。请先退出托盘程序，再继续。"
    Abort
  ${EndIf}
!macroend

Function .onInit
  SetShellVarContext current
  StrCpy $StartMenuFolder "${PRODUCT_NAME}"
  !insertmacro AssertAppNotRunning
FunctionEnd

Function un.onInit
  SetShellVarContext current
  !insertmacro AssertAppNotRunning
FunctionEnd

Section "Install"
  SetOutPath "$INSTDIR"

  ; 覆盖安装：先清掉旧树，避免残留过期 versions/ 碎片。
  ; 用户数据在 %APPDATA%\cronkit，不在安装目录里。
  RMDir /r "$INSTDIR"

  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}\*.*"

  WriteRegStr HKCU "Software\${PRODUCT_ID}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\${PRODUCT_ID}" "Version" "${VERSION}"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" \
    "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" \
    "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" \
    "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" \
    "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" \
    "DisplayIcon" "$INSTDIR\${EXE_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" \
    "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" \
    "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" \
    "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}" \
    "EstimatedSize" "$0"

  CreateDirectory "$SMPROGRAMS\$StartMenuFolder"
  CreateShortCut "$SMPROGRAMS\$StartMenuFolder\${PRODUCT_NAME}.lnk" \
    "$INSTDIR\${EXE_NAME}"
  CreateShortCut "$SMPROGRAMS\$StartMenuFolder\卸载 ${PRODUCT_NAME}.lnk" \
    "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${EXE_NAME}"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\$StartMenuFolder"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_ID}"
  DeleteRegKey HKCU "Software\${PRODUCT_ID}"
  RMDir /r "$INSTDIR"
SectionEnd
