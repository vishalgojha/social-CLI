package ui

import (
    "fmt"
    "strings"

    "github.com/vishalgojha/social-tui/internal/types"
)

type StatusPanel struct {
    Result *types.StatusResult
    Err    error
}

func (p StatusPanel) View(width int) string {
    title := StyleTitle.Render("Status")
    if p.Err != nil {
        body := StyleErr.Render("Error: ") + p.Err.Error()
        return StylePanel.Width(width).Render(title + "\n" + body)
    }
    if p.Result == nil {
        return StylePanel.Width(width).Render(title + "\n" + StyleMuted.Render("Loading..."))
    }

    readiness := p.Result.Readiness
    rows := []string{
        fmt.Sprintf("Profile     %s", valueOrDash(readiness.ActiveProfile)),
        fmt.Sprintf("API         %s", valueOrDash(readiness.DefaultApi)),
        fmt.Sprintf("Onboarding  %s", boolLabel(readiness.OnboardingCompleted, "complete", "pending")),
        fmt.Sprintf("Tokens      %s", boolLabel(readiness.AnyTokenConfigured, "configured", "missing")),
    }

    if p.Result.Service.Running {
        rows = append(rows, fmt.Sprintf("Service     %s", StyleOK.Render("running")))
    } else {
        rows = append(rows, fmt.Sprintf("Service     %s", StyleErr.Render("stopped")))
    }

    if len(readiness.NextActions) > 0 {
        rows = append(rows, "")
        rows = append(rows, StyleMuted.Render("Next actions:"))
        for _, a := range readiness.NextActions {
            rows = append(rows, "  - "+a)
        }
    }

    return StylePanel.Width(width).Render(title + "\n" + strings.Join(rows, "\n"))
}

func valueOrDash(v string) string {
    if strings.TrimSpace(v) == "" {
        return StyleMuted.Render("-")
    }
    return v
}

func boolLabel(ok bool, yes string, no string) string {
    if ok {
        return StyleOK.Render(yes)
    }
    return StyleErr.Render(no)
}
