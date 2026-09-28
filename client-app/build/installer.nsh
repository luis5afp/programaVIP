!macro customInit
  ; userFLOW and Session Manager are independent applications.
  ; A userFLOW update only closes/replaces userFLOW itself and must never
  ; stop, install, downgrade or upgrade Session Manager.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLEX Client.exe"'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLOW.exe"'
  Pop $0
!macroend

!macro customInstall
  ; electron-builder's runAfterFinish applies to the interactive finish page,
  ; but the built-in updater installs with /S and never shows that page.
  ; Relaunch userFLOW explicitly after a successful silent update. The stable
  ; userData directory keeps auth.json/device.json and the browser profiles, so
  ; the relaunched version resumes the existing authenticated client session.
  IfSilent 0 +2
    ExecShell "open" "$INSTDIR\userFLEX Client.exe" "--userflow-updated"
!macroend
