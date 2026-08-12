!macro MDPAD_REGISTER_CONTEXT_VERB EXTENSION
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXTENSION}\shell\ryoww.mdpad.open" "" "mdpadで開く"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXTENSION}\shell\ryoww.mdpad.open" "Icon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXTENSION}\shell\ryoww.mdpad.open" "MultiSelectModel" "Document"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXTENSION}\shell\ryoww.mdpad.open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
!macroend

!macro MDPAD_REMOVE_CONTEXT_VERB EXTENSION
  ReadRegStr $R0 SHCTX "Software\Classes\SystemFileAssociations\.${EXTENSION}\shell\ryoww.mdpad.open\command" ""
  ${If} $R0 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
    DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\.${EXTENSION}\shell\ryoww.mdpad.open"
  ${EndIf}
!macroend

!macro MDPAD_REFRESH_FILE_ASSOCIATIONS
  System::Call "shell32::SHChangeNotify(i,i,i,i) (0x08000000, 0x1000, 0, 0)"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro MDPAD_REGISTER_CONTEXT_VERB "md"
  !insertmacro MDPAD_REGISTER_CONTEXT_VERB "markdown"
  !insertmacro MDPAD_REGISTER_CONTEXT_VERB "txt"
  !insertmacro MDPAD_REFRESH_FILE_ASSOCIATIONS
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro MDPAD_REMOVE_CONTEXT_VERB "md"
  !insertmacro MDPAD_REMOVE_CONTEXT_VERB "markdown"
  !insertmacro MDPAD_REMOVE_CONTEXT_VERB "txt"
  !insertmacro MDPAD_REFRESH_FILE_ASSOCIATIONS
!macroend
