package ui

import (
    "fmt"
    "sort"
    "strings"

    "github.com/vishalgojha/social-tui/internal/types"
)

type DoctorPanel struct {
    Result *types.DoctorResult
    Err    error
}

func (p DoctorPanel) View(width int) string {
    title := StyleTitle.Render("Doctor")
    if p.Err != nil {
        body := StyleErr.Render("Error: ") + p.Err.Error()
        return StylePanel.Width(width).Render(title + "\n" + body)
    }
    if p.Result == nil {
        return StylePanel.Width(width).Render(title + "\n" + StyleMuted.Render("Loading..."))
    }

    var lines []string

    if len(p.Result.Checks) > 0 {
        for _, c := range p.Result.Checks {
            icon := StyleOK.Render("✓")
            if !c.Ok {
                icon = StyleErr.Render("✗")
            }
            value := strings.TrimSpace(c.Value)
            if value == "" {
                value = strings.TrimSpace(c.Detail)
            }
            row := fmt.Sprintf("%s  %s", icon, c.Name)
            if value != "" {
                row += fmt.Sprintf("  %s", value)
            }
            if !c.Ok && c.Fix != "" {
                row += "  →  " + c.Fix
            }
            lines = append(lines, row)
        }
    } else {
        if p.Result.ActiveProfile != "" {
            lines = append(lines, fmt.Sprintf("%s  Profile        %s", StyleOK.Render("✓"), p.Result.ActiveProfile))
        }
        if p.Result.DefaultApi != "" {
            lines = append(lines, fmt.Sprintf("%s  Default API    %s", StyleOK.Render("✓"), p.Result.DefaultApi))
        }
        if p.Result.ApiVersion != "" {
            lines = append(lines, fmt.Sprintf("%s  API version    %s", StyleOK.Render("✓"), p.Result.ApiVersion))
        }
        if len(p.Result.Tokens) > 0 {
            keys := make([]string, 0, len(p.Result.Tokens))
            for k := range p.Result.Tokens {
                keys = append(keys, k)
            }
            sort.Strings(keys)
            for _, k := range keys {
                ok := p.Result.Tokens[k]
                icon := StyleOK.Render("✓")
                status := "set"
                if !ok {
                    icon = StyleErr.Render("✗")
                    status = "missing"
                }
                lines = append(lines, fmt.Sprintf("%s  Token %s  %s", icon, k, status))
            }
        }
        if !p.Result.AppCredentialsConfigured {
            lines = append(lines, fmt.Sprintf("%s  App creds     missing  →  social auth app", StyleWarn.Render("!")))
        } else {
            lines = append(lines, fmt.Sprintf("%s  App creds     configured", StyleOK.Render("✓")))
        }
        if len(p.Result.Blockers) > 0 {
            lines = append(lines, StyleErr.Render("Blockers:"))
            for _, b := range p.Result.Blockers {
                lines = append(lines, "  - "+b)
            }
        }
        if len(p.Result.Advisories) > 0 {
            lines = append(lines, StyleWarn.Render("Advisories:"))
            for _, a := range p.Result.Advisories {
                lines = append(lines, "  - "+a)
            }
        }
    }

    if len(lines) == 0 {
        lines = append(lines, StyleMuted.Render("No checks available."))
    }

    return StylePanel.Width(width).Render(title + "\n" + strings.Join(lines, "\n"))
}
