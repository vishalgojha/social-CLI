package types

type DoctorCheck struct {
    Name   string `json:"name,omitempty"`
    Ok     bool   `json:"ok,omitempty"`
    Value  string `json:"value,omitempty"`
    Fix    string `json:"fix,omitempty"`
    Detail string `json:"detail,omitempty"`
}

type DoctorResult struct {
    Ok                     bool              `json:"ok,omitempty"`
    Issues                 []string          `json:"issues,omitempty"`
    ActiveProfile          string            `json:"activeProfile,omitempty"`
    DefaultApi             string            `json:"defaultApi,omitempty"`
    ConfigPath             string            `json:"configPath,omitempty"`
    ApiVersion             string            `json:"apiVersion,omitempty"`
    Profiles               []string          `json:"profiles,omitempty"`
    Tokens                 map[string]bool   `json:"tokens,omitempty"`
    AppCredentialsConfigured bool            `json:"appCredentialsConfigured,omitempty"`
    Defaults               DoctorDefaults    `json:"defaults,omitempty"`
    Blockers               []string          `json:"blockers,omitempty"`
    Advisories             []string          `json:"advisories,omitempty"`
    AutoFixes              []string          `json:"autoFixes,omitempty"`

    TokenValid   *bool         `json:"token_valid,omitempty"`
    GraphVersion string        `json:"graph_version,omitempty"`
    Scopes       []string      `json:"scopes,omitempty"`
    Checks       []DoctorCheck `json:"checks,omitempty"`
}

type StatusResult struct {
    TokenSet       bool          `json:"token_set,omitempty"`
    ActiveProfile  string        `json:"active_profile,omitempty"`
    DefaultApi     string        `json:"default_api,omitempty"`
    GraphVersion   string        `json:"graph_version,omitempty"`
    AiProvider     string        `json:"ai_provider,omitempty"`
    AiModel        string        `json:"ai_model,omitempty"`
    AiBaseUrl      string        `json:"ai_base_url,omitempty"`
    AiKeySet       bool          `json:"ai_key_set,omitempty"`
    BrowserRuntime BrowserRuntime `json:"browser_runtime,omitempty"`

    Service   StatusService   `json:"service,omitempty"`
    Readiness StatusReadiness `json:"readiness,omitempty"`
}

type BrowserRuntime struct {
    Ready             bool   `json:"ready,omitempty"`
    PackageInstalled  bool   `json:"package_installed,omitempty"`
    ChromiumInstalled bool   `json:"chromium_installed,omitempty"`
    InstallCommand    string `json:"install_command,omitempty"`
}

type DoctorDefaults struct {
    FacebookPageId       string `json:"facebookPageId,omitempty"`
    IgUserId             string `json:"igUserId,omitempty"`
    WhatsappPhoneNumberId string `json:"whatsappPhoneNumberId,omitempty"`
    MarketingAdAccountId string `json:"marketingAdAccountId,omitempty"`
}

type StatusService struct {
    Running  bool          `json:"running,omitempty"`
    Managed  bool          `json:"managed,omitempty"`
    External bool          `json:"external,omitempty"`
    Pid      int           `json:"pid,omitempty"`
    Host     string        `json:"host,omitempty"`
    Port     int           `json:"port,omitempty"`
    StartedAt string       `json:"startedAt,omitempty"`
    Health   ServiceHealth `json:"health,omitempty"`
}

type ServiceHealth struct {
    Ok     bool        `json:"ok,omitempty"`
    Status int         `json:"status,omitempty"`
    Data   interface{} `json:"data,omitempty"`
}

type StatusReadiness struct {
    Ok                     bool                 `json:"ok,omitempty"`
    ActiveProfile          string               `json:"activeProfile,omitempty"`
    DefaultApi             string               `json:"defaultApi,omitempty"`
    OnboardingCompleted    bool                 `json:"onboardingCompleted,omitempty"`
    AppCredentialsConfigured bool               `json:"appCredentialsConfigured,omitempty"`
    AnyTokenConfigured     bool                 `json:"anyTokenConfigured,omitempty"`
    Tokens                 map[string]bool      `json:"tokens,omitempty"`
    Blockers               []StatusIssue        `json:"blockers,omitempty"`
    Warnings               []StatusIssue        `json:"warnings,omitempty"`
    NextActions            []string             `json:"nextActions,omitempty"`
}

type StatusIssue struct {
    Code    string `json:"code,omitempty"`
    Message string `json:"message,omitempty"`
    Fix     string `json:"fix,omitempty"`
}

type LogEntry struct {
    Id        string                 `json:"id,omitempty"`
    Action    string                 `json:"action,omitempty"`
    Target    string                 `json:"target,omitempty"`
    Params    map[string]interface{} `json:"params,omitempty"`
    CreatedAt string                 `json:"created_at,omitempty"`
}
