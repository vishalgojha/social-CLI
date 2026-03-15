package runner

import (
    "encoding/json"
    "fmt"
    "os"
    "os/exec"
    "path/filepath"
    "strings"
)

// SocialBin is the path to the social CLI — defaults to "social" (must be in PATH).
// Override with the SOCIAL_BIN environment variable.
var SocialBin = resolveSocialBin()

func Run(args ...string) (map[string]interface{}, error) {
    out, err := runRaw(args...)
    if err != nil {
        return nil, err
    }
    var result map[string]interface{}
    if err := json.Unmarshal(out, &result); err != nil {
        return nil, err
    }
    return result, nil
}

func RunInto(target interface{}, args ...string) error {
    out, err := runRaw(args...)
    if err != nil {
        return err
    }
    return json.Unmarshal(out, target)
}

func RunRaw(args ...string) ([]byte, error) {
    return runRaw(args...)
}

func runRaw(args ...string) ([]byte, error) {
    cmd := buildCmd(SocialBin, args...)
    out, err := cmd.CombinedOutput()
    if err != nil {
        msg := strings.TrimSpace(string(out))
        if msg != "" {
            return nil, fmt.Errorf("social %s failed: %w: %s", strings.Join(args, " "), err, msg)
        }
        return nil, fmt.Errorf("social %s failed: %w", strings.Join(args, " "), err)
    }
    return out, nil
}

func resolveSocialBin() string {
    if v, ok := os.LookupEnv("SOCIAL_BIN"); ok && strings.TrimSpace(v) != "" {
        return v
    }
    return "social"
}

func buildCmd(bin string, args ...string) *exec.Cmd {
    if strings.HasSuffix(strings.ToLower(bin), ".ps1") {
        pwsh, err := exec.LookPath("pwsh")
        if err != nil {
            pwsh = "powershell"
        }
        fullArgs := append([]string{"-File", bin}, args...)
        return exec.Command(pwsh, fullArgs...)
    }
    if strings.HasSuffix(strings.ToLower(bin), ".js") {
        node, err := exec.LookPath("node")
        if err == nil {
            fullArgs := append([]string{bin}, args...)
            return exec.Command(node, fullArgs...)
        }
    }
    if !filepath.IsAbs(bin) {
        return exec.Command(bin, args...)
    }
    return exec.Command(bin, args...)
}
