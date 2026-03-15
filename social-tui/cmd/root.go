package cmd

import (
    tea "github.com/charmbracelet/bubbletea"
    "github.com/spf13/cobra"
)

type viewType int

const (
    viewDashboard viewType = iota
    viewLogs
    viewOnboard
    viewPost
)

type switchViewMsg viewType

type rootModel struct {
    current   viewType
    width     int
    height    int
    dashboard dashboardModel
    logs      logsModel
    onboard   onboardModel
    post      postModel
}

func newRootModel(initial viewType) rootModel {
    m := rootModel{current: initial}
    m.dashboard = newDashboardModel()
    m.logs = newLogsModel()
    m.onboard = newOnboardModel()
    m.post = newPostModel()
    return m
}

func (m rootModel) Init() tea.Cmd {
    return m.initCurrent()
}

func (m rootModel) initCurrent() tea.Cmd {
    switch m.current {
    case viewLogs:
        return m.logs.Init()
    case viewOnboard:
        return m.onboard.Init()
    case viewPost:
        return m.post.Init()
    default:
        return m.dashboard.Init()
    }
}

func (m rootModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case switchViewMsg:
        m.current = viewType(msg)
        return m, m.initCurrent()
    case tea.WindowSizeMsg:
        m.width = msg.Width
        m.height = msg.Height
        m.dashboard.SetSize(msg.Width, msg.Height)
        m.logs.SetSize(msg.Width, msg.Height)
        m.onboard.SetSize(msg.Width, msg.Height)
        m.post.SetSize(msg.Width, msg.Height)
    }

    switch m.current {
    case viewLogs:
        updated, cmd := m.logs.Update(msg)
        m.logs = updated.(logsModel)
        return m, cmd
    case viewOnboard:
        updated, cmd := m.onboard.Update(msg)
        m.onboard = updated.(onboardModel)
        return m, cmd
    case viewPost:
        updated, cmd := m.post.Update(msg)
        m.post = updated.(postModel)
        return m, cmd
    default:
        updated, cmd := m.dashboard.Update(msg)
        m.dashboard = updated.(dashboardModel)
        return m, cmd
    }
}

func (m rootModel) View() string {
    switch m.current {
    case viewLogs:
        return m.logs.View()
    case viewOnboard:
        return m.onboard.View()
    case viewPost:
        return m.post.View()
    default:
        return m.dashboard.View()
    }
}

var rootCmd = &cobra.Command{
    Use:   "social-tui",
    Short: "TUI wrapper for social-flow",
    RunE: func(cmd *cobra.Command, args []string) error {
        return RunTUI(viewDashboard)
    },
}

func Execute() {
    cobra.CheckErr(rootCmd.Execute())
}

func RunTUI(initial viewType) error {
    program := tea.NewProgram(newRootModel(initial), tea.WithAltScreen())
    if _, err := program.Run(); err != nil {
        return err
    }
    return nil
}

func init() {
    rootCmd.AddCommand(dashboardCmd)
    rootCmd.AddCommand(logsCmd)
    rootCmd.AddCommand(onboardCmd)
    rootCmd.AddCommand(postCmd)
    rootCmd.SetHelpCommand(&cobra.Command{Hidden: true})
    rootCmd.CompletionOptions.DisableDefaultCmd = true
}
