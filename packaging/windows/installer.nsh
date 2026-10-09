; Included in the Windows installer by electron-builder
; (desktop/electron-builder.yml, nsis.include).
!include LogicLib.nsh
!include x64.nsh

; KumoBox installs for the current user only: no admin rights, and no
; "Anyone who uses this computer / Only for me" page.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; After a normal install (not a silent one, such as KumoBox's own updates):
; offer to install the programs KumoBox uses (ffmpeg, mpv and yt-dlp, with
; Scoop) with resources\install-tools.ps1, in a PowerShell window that shows
; the progress. The installer doesn't wait for it.
!macro customInstall
  ; Explorer keeps showing the icons it cached for KumoBox's shortcuts: tell it
  ; icons changed, so a new logo shows right after an update.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${ifNot} ${Silent}
  ${andIfNot} ${isUpdated}
    ${if} ${Cmd} `MessageBox MB_YESNO|MB_ICONQUESTION "Install the programs KumoBox uses?$\r$\n$\r$\nKumoBox can install ffmpeg (for its own player and downloads), mpv and yt-dlp with Scoop, for your Windows user (no administrator rights). A PowerShell window shows the progress: it takes a few minutes and needs an internet connection. Programs you already have are skipped.$\r$\n$\r$\nYou can also do this later in KumoBox: Settings > App > Programs." /SD IDNO IDYES`
      ; The 64-bit PowerShell, also from this 32-bit installer.
      ${DisableX64FSRedirection}
      Exec '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\install-tools.ps1"'
      ${EnableX64FSRedirection}
    ${endIf}
  ${endIf}
!macroend
