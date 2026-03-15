package cmd

import (
    "fmt"
    "strings"

    tea "github.com/charmbracelet/bubbletea"
    "github.com/charmbracelet/lipgloss"
    "github.com/spf13/cobra"

    "github.com/vishalgojha/social-tui/internal/runner"
    "github.com/vishalgojha/social-tui/internal/types"
    "github.com/vishalgojha/social-tui/internal/ui"
)

type doctorMsg struct {
    result *types.DoctorResult
    err    error
}

type statusMsg struct {
    result *types.StatusResult
    err    error
}

type dashboardModel struct {
    width  int
    height int

    doctor *types.DoctorResult
    status *types.StatusResult
    docErr error
    stErr  error
}

func newDashboardModel() dashboardModel {
    return dashboardModel{}
}

func (m dashboardModel) Init() tea.Cmd {
    return tea.Batch(fetchDoctorCmd(), fetchStatusCmd())
}

func (m dashboardModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case doctorMsg:
        m.doctor = msg.result
        m.docErr = msg.err
        return m, nil
    case statusMsg:
        m.status = msg.result
        m.stErr = msg.err
        return m, nil
    case tea.KeyMsg:
        switch strings.ToLower(msg.String()) {
        case "q":
            return m, tea.Quit
        case "r":
            return m, tea.Batch(fetchDoctorCmd(), fetchStatusCmd())
        case "o":
            return m, func() tea.Msg { return switchViewMsg(viewOnboard) }
        case "l":
            return m, func() tea.Msg { return switchViewMsg(viewLogs) }
        }
    }
    return m, nil
}

func (m dashboardModel) View() string {
    header := ui.StyleTitle.Render("social-tui dashboard")
    body := ""

    leftWidth := max(36, m.width/2-2)
    rightWidth := max(36, m.width/2-2)

    left := ui.DoctorPanel{Result: m.doctor, Err: m.docErr}.View(leftWidth)
    right := ui.StatusPanel{Result: m.status, Err: m.stErr}.View(rightWidth)

    if m.width > 0 && m.width < 80 {
        body = left + "\n\n" + right
    } else {
        body = lipgloss.JoinHorizontal(lipgloss.Top, left, right)
    }

    hints := ui.StyleMuted.Render("r") + " refresh  " + ui.StyleMuted.Render("o") + " onboard  " + ui.StyleMuted.Render("l") + " logs  " + ui.StyleMuted.Render("q") + " quit"

    return fmt.Sprintf("%s\n\n%s\n\n%s", header, body, hints)
}

func (m *dashboardModel) SetSize(width int, height int) {
    m.width = width
    m.height = height
}

func fetchDoctorCmd() tea.Cmd {
    return func() tea.Msg {
        var res types.DoctorResult
        if err := runner.RunInto(&res, "doctor", "--json"); err != nil {
            return doctorMsg{err: err}
        }
        return doctorMsg{result: &res}
    }
}

func fetchStatusCmd() tea.Cmd {
    return func() tea.Msg {
        var res types.StatusResult
        if err := runner.RunInto(&res, "status", "--json"); err != nil {
            return statusMsg{err: err}
        }
        return statusMsg{result: &res}
    }
}

var dashboardCmd = &cobra.Command{
    Use:   "dashboard",
    Short: "Open the dashboard view",
    RunE: func(cmd *cobra.Command, args []string) error {
        return RunTUI(viewDashboard)
    },
}

func max(a, b int) int {
    if a > b {
        return a
    }
    return b
}
