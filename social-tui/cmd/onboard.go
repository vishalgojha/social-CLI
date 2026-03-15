package cmd

import (
    "os/exec"
    "strings"

    tea "github.com/charmbracelet/bubbletea"
    "github.com/charmbracelet/bubbles/spinner"
    "github.com/charmbracelet/bubbles/textinput"
    "github.com/spf13/cobra"

    "github.com/vishalgojha/social-tui/internal/runner"
    "github.com/vishalgojha/social-tui/internal/types"
    "github.com/vishalgojha/social-tui/internal/ui"
)

type onboardPhase int

const (
    onboardSelectApi onboardPhase = iota
    onboardInstructions
    onboardEnterToken
    onboardRunning
    onboardDone
    onboardError
)

type onboardDoctorMsg struct {
    result *types.DoctorResult
    err    error
}

type onboardRunMsg struct {
    output string
    err    error
}

type onboardModel struct {
    width  int
    height int

    phase      onboardPhase
    apiOptions []string
    apiIndex   int
    apiVersion string

    tokenInput textinput.Model

    runErr    error
    runOutput string

    spin spinner.Model
}

func newOnboardModel() onboardModel {
    sp := spinner.New()
    sp.Spinner = spinner.Line

    input := textinput.New()
    input.Placeholder = "Paste access token here"
    input.CharLimit = 2048
    input.EchoMode = textinput.EchoPassword
    input.EchoCharacter = '*'

    return onboardModel{
        phase:      onboardSelectApi,
        apiOptions: []string{"facebook", "instagram", "whatsapp"},
        tokenInput: input,
        spin:       sp,
    }
}

func (m onboardModel) Init() tea.Cmd {
    return tea.Batch(fetchDoctorVersionCmd(), m.spin.Tick)
}

func (m onboardModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case onboardDoctorMsg:
        if msg.err == nil && msg.result != nil {
            if msg.result.ApiVersion != "" {
                m.apiVersion = msg.result.ApiVersion
            }
        }
        return m, nil
    case onboardRunMsg:
        m.runErr = msg.err
        m.runOutput = msg.output
        if msg.err != nil {
            m.phase = onboardError
        } else {
            m.phase = onboardDone
        }
        return m, nil
    case spinner.TickMsg:
        var cmd tea.Cmd
        m.spin, cmd = m.spin.Update(msg)
        return m, cmd
    case tea.KeyMsg:
        key := strings.ToLower(msg.String())
        switch m.phase {
        case onboardSelectApi:
            switch key {
            case "q":
                return m, tea.Quit
            case "up":
                if m.apiIndex > 0 {
                    m.apiIndex--
                }
                return m, nil
            case "down":
                if m.apiIndex < len(m.apiOptions)-1 {
                    m.apiIndex++
                }
                return m, nil
            case "enter":
                m.phase = onboardInstructions
                return m, nil
            }
        case onboardInstructions:
            switch key {
            case "q":
                return m, tea.Quit
            case "esc":
                m.phase = onboardSelectApi
                return m, nil
            case "o":
                url := tokenHelpUrl(m.selectedApi(), m.apiVersion)
                if url != "" {
                    _ = openUrl(url)
                } else if m.selectedApi() == "whatsapp" {
                    _ = openUrl("https://developers.facebook.com/apps/")
                }
                return m, nil
            case "enter":
                m.phase = onboardEnterToken
                m.tokenInput.Focus()
                return m, nil
            }
        case onboardEnterToken:
            if key == "esc" {
                m.phase = onboardInstructions
                m.tokenInput.Blur()
                return m, nil
            }
            if key == "enter" {
                token := strings.TrimSpace(m.tokenInput.Value())
                if token == "" {
                    return m, nil
                }
                m.phase = onboardRunning
                return m, tea.Batch(runAuthLoginCmd(m.selectedApi(), token), m.spin.Tick)
            }
            var cmd tea.Cmd
            m.tokenInput, cmd = m.tokenInput.Update(msg)
            return m, cmd
        case onboardRunning:
            if key == "q" {
                return m, tea.Quit
            }
        case onboardDone, onboardError:
            switch key {
            case "q":
                return m, tea.Quit
            case "d":
                return m, func() tea.Msg { return switchViewMsg(viewDashboard) }
            case "r":
                m.phase = onboardSelectApi
                m.runErr = nil
                m.runOutput = ""
                m.tokenInput.SetValue("")
                return m, nil
            }
        }
    }

    return m, nil
}

func (m onboardModel) View() string {
    title := ui.StyleTitle.Render("Onboard")

    switch m.phase {
    case onboardSelectApi:
        body := renderApiSelect(m.apiOptions, m.apiIndex)
        hints := ui.StyleMuted.Render("↑↓") + " select  " + ui.StyleMuted.Render("Enter") + " continue  " + ui.StyleMuted.Render("q") + " quit"
        return ui.StylePanel.Width(m.width).Render(title+"\n"+body) + "\n\n" + hints
    case onboardInstructions:
        body := renderInstructions(m.selectedApi(), m.apiVersion)
        hints := ui.StyleMuted.Render("o") + " open page  " + ui.StyleMuted.Render("Enter") + " paste token  " + ui.StyleMuted.Render("ESC") + " back  " + ui.StyleMuted.Render("q") + " quit"
        return ui.StylePanel.Width(m.width).Render(title+"\n"+body) + "\n\n" + hints
    case onboardEnterToken:
        body := "Paste your access token below:\n\n" + m.tokenInput.View()
        hints := ui.StyleMuted.Render("Enter") + " save  " + ui.StyleMuted.Render("ESC") + " back  " + ui.StyleMuted.Render("q") + " quit"
        return ui.StylePanel.Width(m.width).Render(title+"\n"+body) + "\n\n" + hints
    case onboardRunning:
        body := m.spin.View() + " Validating token and saving config..."
        return ui.StylePanel.Width(m.width).Render(title+"\n"+body)
    case onboardDone:
        body := ui.StyleOK.Render("Token saved successfully.") + "\n\n" + truncateBlock(m.runOutput, 10)
        hints := ui.StyleMuted.Render("d") + " dashboard  " + ui.StyleMuted.Render("r") + " restart  " + ui.StyleMuted.Render("q") + " quit"
        return ui.StylePanel.Width(m.width).Render(title+"\n"+body) + "\n\n" + hints
    case onboardError:
        body := ui.StyleErr.Render("Login failed.") + "\n\n" + truncateBlock(m.runOutput, 12)
        hints := ui.StyleMuted.Render("r") + " retry  " + ui.StyleMuted.Render("q") + " quit"
        return ui.StylePanel.Width(m.width).Render(title+"\n"+body) + "\n\n" + hints
    default:
        return ui.StylePanel.Width(m.width).Render(title + "\n" + ui.StyleMuted.Render("Loading..."))
    }
}

func (m *onboardModel) SetSize(width int, height int) {
    m.width = width
    m.height = height
}

func (m onboardModel) selectedApi() string {
    if m.apiIndex < 0 || m.apiIndex >= len(m.apiOptions) {
        return "facebook"
    }
    return m.apiOptions[m.apiIndex]
}

func renderApiSelect(options []string, selected int) string {
    var lines []string
    lines = append(lines, "Choose an API to connect:")
    lines = append(lines, "")
    for i, opt := range options {
        cursor := "  "
        if i == selected {
            cursor = ui.StyleOK.Render("> ")
            lines = append(lines, cursor+ui.StyleBold.Render(opt))
        } else {
            lines = append(lines, cursor+opt)
        }
    }
    return strings.Join(lines, "\n")
}

func renderInstructions(api string, apiVersion string) string {
    if apiVersion == "" {
        apiVersion = "v20.0"
    }

    if api == "whatsapp" {
        return strings.Join([]string{
            "WhatsApp tokens are generated from the Meta App Dashboard.",
            "",
            "Steps:",
            "1) Open Meta App Dashboard",
            "2) Select your app -> WhatsApp -> API Setup",
            "3) Generate an access token and copy it",
            "",
            "Press 'o' to open the dashboard in your browser.",
        }, "\n")
    }

    url := tokenHelpUrl(api, apiVersion)
    return strings.Join([]string{
        "We will open Graph Explorer to generate your access token.",
        "",
        "Steps:",
        "1) Login with your Facebook account",
        "2) Select your app",
        "3) Generate a token with required permissions",
        "4) Copy the token",
        "",
        "Token page:",
        url,
        "",
        "Press 'o' to open the token page in your browser.",
    }, "\n")
}

func tokenHelpUrl(api string, apiVersion string) string {
    if api == "whatsapp" {
        return ""
    }
    if strings.TrimSpace(apiVersion) == "" {
        apiVersion = "v20.0"
    }
    return "https://developers.facebook.com/tools/explorer/?version=" + apiVersion
}

func openUrl(url string) error {
    if strings.TrimSpace(url) == "" {
        return nil
    }
    cmd := exec.Command("cmd", "/c", "start", "", url)
    return cmd.Start()
}

func runAuthLoginCmd(api string, token string) tea.Cmd {
    return func() tea.Msg {
        args := []string{"auth", "login", "-a", api, "--token", token, "--no-open"}
        data, err := runner.RunRaw(args...)
        out := string(data)
        if err != nil {
            return onboardRunMsg{err: err, output: out}
        }
        return onboardRunMsg{output: out}
    }
}

func fetchDoctorVersionCmd() tea.Cmd {
    return func() tea.Msg {
        var res types.DoctorResult
        if err := runner.RunInto(&res, "doctor", "--json"); err != nil {
            return onboardDoctorMsg{err: err}
        }
        return onboardDoctorMsg{result: &res}
    }
}

func truncateBlock(text string, maxLines int) string {
    lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
    if len(lines) <= maxLines {
        return text
    }
    return strings.Join(lines[:maxLines], "\n") + "\n..."
}

var onboardCmd = &cobra.Command{
    Use:   "onboard",
    Short: "Run the onboarding flow",
    RunE: func(cmd *cobra.Command, args []string) error {
        return RunTUI(viewOnboard)
    },
}
