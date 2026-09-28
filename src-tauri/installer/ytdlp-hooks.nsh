!macro NSIS_HOOK_PREUNINSTALL
  ; Upgrades keep the user's integration and cookie opt-in unchanged.
  ${If} $UpdateMode <> 1
    !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
    IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 ytdlp_restore_done
    ClearErrors
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --restore-ytdlp' $0
    ${If} ${Errors}
      MessageBox MB_ICONSTOP "Could not restore VRChat playback tools. Disable the integration in Settings > Media before uninstalling."
      Abort
    ${EndIf}
    ${If} $0 <> 0
      MessageBox MB_ICONSTOP "VRChat playback tools need manual review. Open Settings > Media and disable the integration, then retry uninstalling. Original backups are kept in the VRChat Tools folder."
      Abort
    ${EndIf}
    ytdlp_restore_done:
  ${EndIf}
!macroend
