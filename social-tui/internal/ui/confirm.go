package ui

import "github.com/charmbracelet/lipgloss"

func ConfirmPanel(title string, body string, footer string, width int) string {
    box := StylePanel.Width(width)
    content := StyleTitle.Render(title) + "\n" + body
    if footer != "" {
        content += "\n\n" + lipgloss.NewStyle().Foreground(ColorMuted).Render(footer)
    }
    return box.Render(content)
}
