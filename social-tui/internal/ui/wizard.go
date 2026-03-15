package ui

import (
    "fmt"
    "strings"

    "github.com/charmbracelet/lipgloss"
)

type WizardStep struct {
    Title string
    Body  string
}

type Wizard struct {
    Steps []WizardStep
    Index int
    Width int
}

func (w Wizard) ProgressBar() string {
    if len(w.Steps) == 0 {
        return ""
    }
    total := len(w.Steps)
    filled := w.Index + 1
    if filled < 0 {
        filled = 0
    }
    if filled > total {
        filled = total
    }
    barWidth := 24
    if w.Width > 0 {
        barWidth = min(36, max(18, w.Width/4))
    }
    filledCount := int(float64(barWidth) * (float64(filled) / float64(total)))
    if filledCount > barWidth {
        filledCount = barWidth
    }
    bar := strings.Repeat("█", filledCount) + strings.Repeat("░", barWidth-filledCount)
    label := fmt.Sprintf("Step %d of %d", filled, total)
    return lipgloss.JoinHorizontal(lipgloss.Left, StyleBold.Render(label), " ", StyleMuted.Render(bar))
}

func min(a, b int) int {
    if a < b {
        return a
    }
    return b
}

func max(a, b int) int {
    if a > b {
        return a
    }
    return b
}
