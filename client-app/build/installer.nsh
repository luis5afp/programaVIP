!macro customInit
  ; Close stale userFLOW/userFLEX processes so upgrades can replace the
  ; executable. Do not use /T: the updater helper is a child of the old app
  ; and must remain alive until the installer completes.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLEX Client.exe"'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLOW.exe"'
  Pop $0
  Sleep 800
!macroend

!macro customInstall
  ; For automatic updates, relaunch from the installer itself. At this point
  ; $INSTDIR is the authoritative final installation directory, so this does
  ; not depend on the path used by the previous version.
  ${if} ${isUpdated}
    Exec '"$INSTDIR\userFLEX Client.exe" --updated'
  ${endIf}
!macroend
