!macro customInit
  ; The installer is already running as an independent process. Close only the
  ; old application executable so NSIS can replace it safely.
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLEX Client.exe"'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /F /IM "userFLOW.exe"'
  Pop $0
  Sleep 800
!macroend

!macro customInstall
  ; Automatic updates are invoked with /S. Relaunch deterministically after a
  ; successful silent install instead of depending only on NSIS isUpdated.
  IfSilent silent_relaunch interactive_install

  silent_relaunch:
    Exec '"$INSTDIR\userFLEX Client.exe" --updated'
    Goto install_done

  interactive_install:
    ${if} ${isUpdated}
      Exec '"$INSTDIR\userFLEX Client.exe" --updated'
    ${endIf}

  install_done:
!macroend
