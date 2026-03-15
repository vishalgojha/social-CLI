# social-tui

A Go TUI wrapper for the `social` CLI (social-flow). It runs the existing `social` binary and renders JSON responses in a polished terminal UI.

## Prerequisites

- Go 1.22+
- `social` binary in your `PATH`

## Build

```bash
go build -o social-tui .
```

## Usage

```bash
./social-tui
./social-tui dashboard
./social-tui logs
./social-tui onboard
./social-tui post
```
