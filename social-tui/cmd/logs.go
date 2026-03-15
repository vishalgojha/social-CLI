package cmd

import (
    "encoding/json"
    "fmt"
    "strings"

    tea "github.com/charmbracelet/bubbletea"
    "github.com/charmbracelet/bubbles/spinner"
    "github.com/charmbracelet/bubbles/table"
    "github.com/charmbracelet/bubbles/viewport"
    "github.com/spf13/cobra"

    "github.com/vishalgojha/social-tui/internal/runner"
    "github.com/vishalgojha/social-tui/internal/types"
    "github.com/vishalgojha/social-tui/internal/ui"
)

type logsMsg struct {
    entries []types.LogEntry
    rawText string
    rawMode bool
    err     error
}

type replayMsg struct {
    result string
    err    error
}

type startLoadingMsg struct{}

type logsModel struct {
    width  int
    height int

    logs       []types.LogEntry
    table      table.Model
    tableReady bool
    viewport   viewport.Model
    showDetail bool
    rawMode    bool
    rawText    string

    loading    bool
    replaying  bool
    err        error
    replayErr  error
    replayText string

    spin spinner.Model
}

func newLogsModel() logsModel {
    sp := spinner.New()
    sp.Spinner = spinner.Line
    vp := viewport.New(0, 0)
    return logsModel{spin: sp, loading: true, viewport: vp}
}

func (m logsModel) Init() tea.Cmd {
    return tea.Batch(func() tea.Msg { return startLoadingMsg{} }, fetchLogsCmd(), m.spin.Tick)
}

func (m logsModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case startLoadingMsg:
        m.loading = true
        m.err = nil
        m.replayErr = nil
        m.replayText = ""
        m.rawMode = false
        m.rawText = ""
        return m, nil
    case logsMsg:
        m.loading = false
        m.err = msg.err
        if msg.err == nil {
            if msg.rawMode {
                m.rawMode = true
                m.rawText = msg.rawText
                m.tableReady = false
                m.logs = nil
                m.viewport.SetContent(msg.rawText)
            } else {
                m.rawMode = false
                m.rawText = ""
                m.logs = msg.entries
                m.table = ui.NewLogTable(m.logs, m.width, m.tableHeight())
                m.tableReady = true
            }
            if m.showDetail {
                m.viewport.SetContent(m.detailContent())
            }
        } else {
            m.tableReady = false
        }
        return m, nil
    case replayMsg:
        m.replaying = false
        m.replayErr = msg.err
        m.replayText = msg.result
        if m.showDetail {
            m.viewport.SetContent(m.detailContent())
        }
        return m, nil
    case tea.KeyMsg:
        switch msg.String() {
        case "q":
            return m, tea.Quit
        case "enter":
            if m.showDetail {
                return m, nil
            }
            if m.rawMode {
                return m, nil
            }
            m.showDetail = true
            m.viewport.Width = m.width
            m.viewport.Height = m.detailHeight()
            m.viewport.SetContent(m.detailContent())
            if m.tableReady {
                m.table.SetHeight(m.tableHeight())
            }
            return m, nil
        case "esc":
            if m.showDetail {
                m.showDetail = false
                m.replayText = ""
                m.replayErr = nil
                if m.tableReady {
                    m.table.SetHeight(m.tableHeight())
                }
            }
            return m, nil
        case "r":
            if m.rawMode {
                m.loading = true
                return m, tea.Batch(func() tea.Msg { return startLoadingMsg{} }, fetchLogsCmd(), m.spin.Tick)
            }
            if len(m.logs) == 0 {
                return m, nil
            }
            m.replaying = true
            return m, tea.Batch(replayLogCmd(m.selectedID()), m.spin.Tick)
        }
    case spinner.TickMsg:
        if m.loading || m.replaying {
            var cmd tea.Cmd
            m.spin, cmd = m.spin.Update(msg)
            return m, cmd
        }
    }

    if m.rawMode {
        var cmd tea.Cmd
        m.viewport, cmd = m.viewport.Update(msg)
        return m, cmd
    }

    if m.showDetail {
        var cmd tea.Cmd
        m.viewport, cmd = m.viewport.Update(msg)
        return m, cmd
    }

    if m.tableReady {
        var cmd tea.Cmd
        m.table, cmd = m.table.Update(msg)
        return m, cmd
    }

    return m, nil
}

func (m logsModel) View() string {
    header := ui.StyleTitle.Render("Logs")

    if m.loading {
        return fmt.Sprintf("%s\n\n%s Loading logs...", header, m.spin.View())
    }

    if m.err != nil {
        return fmt.Sprintf("%s\n\n%s", header, ui.StyleErr.Render(m.err.Error()))
    }

    if m.rawMode {
        m.viewport.Width = m.width
        h := m.height - 6
        if h < 6 {
            h = 6
        }
        m.viewport.Height = h
        rawPanel := ui.StylePanel.Width(m.width).Render(m.viewport.View())
        hint := ui.StyleMuted.Render("r") + " refresh  " + ui.StyleMuted.Render("q") + " quit"
        return fmt.Sprintf("%s\n\n%s\n\n%s", header, rawPanel, hint)
    }

    tableView := ""
    if m.tableReady {
        tableView = m.table.View()
    }

    hint := ui.StyleMuted.Render("↑/↓") + " move  " + ui.StyleMuted.Render("Enter") + " expand  " + ui.StyleMuted.Render("r") + " replay  " + ui.StyleMuted.Render("ESC") + " close  " + ui.StyleMuted.Render("q") + " quit"

    if !m.showDetail {
        return fmt.Sprintf("%s\n\n%s\n\n%s", header, tableView, hint)
    }

    detail := ui.StylePanel.Width(m.width).Render(m.viewport.View())

    return fmt.Sprintf("%s\n\n%s\n\n%s\n\n%s", header, tableView, detail, hint)
}

func (m *logsModel) SetSize(width int, height int) {
    m.width = width
    m.height = height
    if m.tableReady {
        m.table.SetWidth(width)
        m.table.SetHeight(m.tableHeight())
    }
    m.viewport.Width = width
    m.viewport.Height = m.detailHeight()
}

func (m logsModel) tableHeight() int {
    if m.height == 0 {
        return 12
    }
    h := m.height - 8
    if m.showDetail {
        h = m.height / 2
    }
    if h < 6 {
        h = 6
    }
    return h
}

func (m logsModel) detailHeight() int {
    if m.height == 0 {
        return 10
    }
    h := m.height - m.tableHeight() - 8
    if h < 6 {
        h = 6
    }
    return h
}

func (m logsModel) selectedID() string {
    if len(m.logs) == 0 || !m.tableReady {
        return ""
    }
    idx := m.table.Cursor()
    if idx < 0 || idx >= len(m.logs) {
        return ""
    }
    return m.logs[idx].Id
}

func (m logsModel) detailContent() string {
    if len(m.logs) == 0 || !m.tableReady {
        return ui.StyleMuted.Render("No log selected.")
    }
    idx := m.table.Cursor()
    if idx < 0 || idx >= len(m.logs) {
        return ui.StyleMuted.Render("No log selected.")
    }
    entry := m.logs[idx]

    payload := map[string]interface{}{
        "id":         entry.Id,
        "action":     entry.Action,
        "target":     entry.Target,
        "created_at": entry.CreatedAt,
        "params":     entry.Params,
    }
    raw, _ := json.MarshalIndent(payload, "", "  ")

    content := string(raw)
    if m.replaying {
        content = m.spin.View() + " Replaying...\n\n" + content
    } else if m.replayErr != nil {
        content = ui.StyleErr.Render("Replay failed: "+m.replayErr.Error()) + "\n\n" + content
    } else if strings.TrimSpace(m.replayText) != "" {
        content = ui.StyleOK.Render("Replay result:") + "\n" + m.replayText + "\n\n" + content
    }

    return content
}

func fetchLogsCmd() tea.Cmd {
    return func() tea.Msg {
        data, err := runner.RunRaw("logs")
        if err != nil {
            return logsMsg{err: err}
        }

        var entries []types.LogEntry
        if err := json.Unmarshal(data, &entries); err == nil {
            return logsMsg{entries: entries}
        }

        var wrapped struct {
            Logs []types.LogEntry `json:"logs"`
        }
        if err := json.Unmarshal(data, &wrapped); err == nil {
            return logsMsg{entries: wrapped.Logs}
        }

        raw := strings.TrimSpace(string(data))
        if raw != "" {
            return logsMsg{rawMode: true, rawText: raw}
        }

        return logsMsg{err: fmt.Errorf("unable to parse logs output")}
    }
}

func replayLogCmd(id string) tea.Cmd {
    return func() tea.Msg {
        if id == "" {
            return replayMsg{err: fmt.Errorf("no log selected")}
        }
        data, err := runner.RunRaw("replay", id)
        if err != nil {
            return replayMsg{err: err}
        }

        var pretty strings.Builder
        var obj interface{}
        if err := json.Unmarshal(data, &obj); err == nil {
            b, _ := json.MarshalIndent(obj, "", "  ")
            pretty.Write(b)
        } else {
            pretty.Write(data)
        }
        return replayMsg{result: pretty.String()}
    }
}

var logsCmd = &cobra.Command{
    Use:   "logs",
    Short: "Browse social-flow logs",
    RunE: func(cmd *cobra.Command, args []string) error {
        return RunTUI(viewLogs)
    },
}
