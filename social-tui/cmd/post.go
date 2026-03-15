package cmd

import (
    "encoding/json"
    "fmt"
    "strings"

    tea "github.com/charmbracelet/bubbletea"
    "github.com/charmbracelet/bubbles/spinner"
    "github.com/charmbracelet/bubbles/textinput"
    "github.com/spf13/cobra"

    "github.com/vishalgojha/social-tui/internal/runner"
    "github.com/vishalgojha/social-tui/internal/ui"
)

type postStage int

const (
    postEdit postStage = iota
    postConfirm
    postPosting
    postDone
)

type postResultMsg struct {
    result string
    err    error
}

type postModel struct {
    width  int
    height int

    stage postStage

    msgInput   textinput.Model
    pageInput  textinput.Model
    focusIndex int

    posting bool
    err     error
    result  string

    spin spinner.Model
}

func newPostModel() postModel {
    msg := textinput.New()
    msg.Placeholder = "Write your post message"
    msg.CharLimit = 1000
    msg.Focus()

    page := textinput.New()
    page.Placeholder = "(default)"
    page.CharLimit = 200

    sp := spinner.New()
    sp.Spinner = spinner.Line

    return postModel{
        stage:    postEdit,
        msgInput: msg,
        pageInput: page,
        spin:     sp,
    }
}

func (m postModel) Init() tea.Cmd {
    return nil
}

func (m postModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case postResultMsg:
        m.posting = false
        m.stage = postDone
        m.err = msg.err
        m.result = msg.result
        return m, nil
    case spinner.TickMsg:
        if m.posting {
            var cmd tea.Cmd
            m.spin, cmd = m.spin.Update(msg)
            return m, cmd
        }
    case tea.KeyMsg:
        switch msg.String() {
        case "q":
            return m, tea.Quit
        case "tab":
            if m.stage == postEdit {
                m.focusIndex = (m.focusIndex + 1) % 2
                if m.focusIndex == 0 {
                    m.msgInput.Focus()
                    m.pageInput.Blur()
                } else {
                    m.pageInput.Focus()
                    m.msgInput.Blur()
                }
                return m, nil
            }
        case "enter":
            if m.stage == postEdit {
                m.stage = postConfirm
                return m, nil
            }
        case "y":
            if m.stage == postConfirm {
                m.stage = postPosting
                m.posting = true
                return m, tea.Batch(runPostCmd(m.msgInput.Value(), m.pageInput.Value()), m.spin.Tick)
            }
        case "n":
            if m.stage == postConfirm {
                m.stage = postEdit
                m.focusIndex = 0
                m.msgInput.Focus()
                m.pageInput.Blur()
                return m, nil
            }
        }
    }

    if m.stage == postEdit {
        var cmd tea.Cmd
        if m.focusIndex == 0 {
            m.msgInput, cmd = m.msgInput.Update(msg)
        } else {
            m.pageInput, cmd = m.pageInput.Update(msg)
        }
        return m, cmd
    }

    return m, nil
}

func (m postModel) View() string {
    switch m.stage {
    case postConfirm:
        body := fmt.Sprintf("\"%s\"\n\nThis will POST to your Facebook page.\nRisk level: %s", strings.TrimSpace(m.msgInput.Value()), ui.StyleWarn.Render("MEDIUM"))
        return ui.ConfirmPanel("Confirm Post", body, "[y] confirm   [n] edit   [q] cancel", m.width)
    case postPosting:
        return fmt.Sprintf("%s Posting...", m.spin.View())
    case postDone:
        if m.err != nil {
            return ui.StyleErr.Render("Post failed: " + m.err.Error())
        }
        return ui.StyleOK.Render("Post completed") + "\n" + m.result + "\n\n" + ui.StyleMuted.Render("Press q to quit")
    default:
        return m.renderEditor()
    }
}

func (m *postModel) SetSize(width int, height int) {
    m.width = width
    m.height = height
}

func (m postModel) renderEditor() string {
    box := ui.StylePanel.Width(m.width)
    lines := []string{
        ui.StyleTitle.Render("New Post"),
        "Message:",
        m.msgInput.View(),
        "",
        "Page ID:",
        m.pageInput.View(),
        "",
        ui.StyleMuted.Render("[Enter] preview   [Tab] switch field   [q] cancel"),
    }
    return box.Render(strings.Join(lines, "\n"))
}

func runPostCmd(message string, pageID string) tea.Cmd {
    return func() tea.Msg {
        args := []string{"post", "create", "--message", message}
        if strings.TrimSpace(pageID) != "" {
            args = append(args, "--page-id", strings.TrimSpace(pageID))
        }
        data, err := runner.RunRaw(args...)
        if err != nil {
            return postResultMsg{err: err}
        }

        var obj interface{}
        if err := json.Unmarshal(data, &obj); err == nil {
            b, _ := json.MarshalIndent(obj, "", "  ")
            return postResultMsg{result: string(b)}
        }
        return postResultMsg{result: string(data)}
    }
}

var postCmd = &cobra.Command{
    Use:   "post",
    Short: "Create a new post with confirmation",
    RunE: func(cmd *cobra.Command, args []string) error {
        return RunTUI(viewPost)
    },
}
