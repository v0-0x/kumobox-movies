; Included in the Windows installer by electron-builder
; (desktop/electron-builder.yml, nsis.include).
!include LogicLib.nsh
!include x64.nsh

; Moviko installs for the current user only: no admin rights, and no
; "Anyone who uses this computer / Only for me" page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Moviko was called KumoBox before 2.0.9: an update over KumoBox installs in a
; Moviko folder next to KumoBox's (...\Programs\Moviko), and KumoBox's own
; uninstaller then removes the KumoBox one, as with any update.
!macro customInit
  StrCpy $0 $INSTDIR "" -8
  ${if} $0 == "\KumoBox"
    StrCpy $INSTDIR $INSTDIR -8
    StrCpy $INSTDIR "$INSTDIR\Moviko"
  ${endIf}
!macroend

; After a normal install (not a silent one, such as Moviko's own updates):
; offer to install the programs Moviko uses (ffmpeg, mpv and yt-dlp, with
; Scoop) with resources\install-tools.ps1, in a PowerShell window that shows
; the progress. The installer doesn't wait for it.
!macro customInstall
  ; Explorer keeps showing the icons it cached for Moviko's shortcuts: tell it
  ; icons changed, so a new logo shows right after an update.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; Started with Windows (desktop/main.js setStartAtLogin): the entry names
  ; the program, which an update over KumoBox moved and renamed.
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "app.kumobox.desktop"
  ${if} $0 != ""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "app.kumobox.desktop" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --background'
  ${endIf}
  ${ifNot} ${Silent}
  ${andIfNot} ${isUpdated}
    ${if} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION "Install the programs Moviko uses?$\r$\n$\r$\nMoviko can install ffmpeg (for its own player and downloads), mpv and yt-dlp with Scoop, for your Windows user (no administrator rights). A PowerShell window shows the progress: it takes a few minutes and needs an internet connection. Programs you already have are skipped.$\r$\n$\r$\nYou can also do this later in Moviko: Settings > Desktop app & programs." /SD IDNO IDYES`
      ; The 64-bit PowerShell, also from this 32-bit installer.
      ${DisableX64FSRedirection}
      Exec '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\install-tools.ps1"'
      ${EnableX64FSRedirection}
    ${endIf}
  ${endIf}
!macroend

; Uninstalled (not updated): Moviko's "start with Windows" entry goes too
; (desktop/main.js setStartAtLogin), or Startup apps keeps a dead "Moviko".
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "app.kumobox.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "app.kumobox.desktop"
  ${endIf}
!macroend
