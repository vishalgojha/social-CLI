package ui

import (
    "fmt"
    "time"

    "github.com/charmbracelet/bubbles/table"
    "github.com/charmbracelet/lipgloss"

    "github.com/vishalgojha/social-tui/internal/types"
)

func NewLogTable(entries []types.LogEntry, width int, height int) table.Model {
    columns := []table.Column{
        {Title: "ID", Width: 16},
        {Title: "ACTION", Width: 12},
        {Title: "TARGET", Width: 10},
        {Title: "TIME", Width: 12},
    }

    rows := make([]table.Row, 0, len(entries))
    for _, e := range entries {
        rows = append(rows, table.Row{e.Id, e.Action, e.Target, formatAge(e.CreatedAt)})
    }

    t := table.New(
        table.WithColumns(columns),
        table.WithRows(rows),
        table.WithFocused(true),
        table.WithHeight(height),
    )

    style := table.DefaultStyles()
    style.Header = style.Header.
        BorderStyle(lipgloss.NormalBorder()).
        BorderForeground(ColorBorder).
        BorderBottom(true).
        Bold(true)
    style.Selected = style.Selected.
        Foreground(ColorBlue).
        Bold(true)
    t.SetStyles(style)

    if width > 0 {
        t.SetWidth(width)
    }

    return t
}

func formatAge(ts string) string {
    if ts == "" {
        return "-"
    }
    parsed, err := time.Parse(time.RFC3339, ts)
    if err != nil {
        return ts
    }
    delta := time.Since(parsed)
    if delta < time.Minute {
        return "just now"
    }
    if delta < time.Hour {
        mins := int(delta.Minutes())
        return fmt.Sprintf("%dm ago", mins)
    }
    if delta < 24*time.Hour {
        hours := int(delta.Hours())
        return fmt.Sprintf("%dh ago", hours)
    }
    days := int(delta.Hours() / 24)
    return fmt.Sprintf("%dd ago", days)
}
