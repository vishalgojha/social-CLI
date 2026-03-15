package ui

import "github.com/charmbracelet/lipgloss"

var (
    ColorGreen  = lipgloss.Color("#00D26A")
    ColorRed    = lipgloss.Color("#FF4D4F")
    ColorYellow = lipgloss.Color("#FFB347")
    ColorBlue   = lipgloss.Color("#4D9FFF")
    ColorMuted  = lipgloss.Color("#666666")
    ColorBorder = lipgloss.Color("#333333")

    StyleOK    = lipgloss.NewStyle().Foreground(ColorGreen).Bold(true)
    StyleErr   = lipgloss.NewStyle().Foreground(ColorRed).Bold(true)
    StyleWarn  = lipgloss.NewStyle().Foreground(ColorYellow)
    StyleMuted = lipgloss.NewStyle().Foreground(ColorMuted)
    StyleBold  = lipgloss.NewStyle().Bold(true)

    StylePanel = lipgloss.NewStyle().
            Border(lipgloss.RoundedBorder()).
            BorderForeground(ColorBorder).
            Padding(1, 2)

    StyleTitle = lipgloss.NewStyle().
            Bold(true).
            Foreground(ColorBlue).
            MarginBottom(1)
)
