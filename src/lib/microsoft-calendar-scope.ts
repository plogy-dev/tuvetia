// Scope de Microsoft Graph para Outlook Calendar. Se pide en el login/signup con Microsoft
// (auto-sync) y en el botón "Conectar Outlook Calendar" (reconexión manual). A diferencia de Google
// (que usa el query param `access_type=offline`), Azure AD solo emite refresh_token si `offline_access`
// va explícito en el scope.
export const MICROSOFT_CALENDAR_SCOPE = "offline_access Calendars.ReadWrite"
