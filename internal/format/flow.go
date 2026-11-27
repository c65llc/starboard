// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package format

import (
	"errors"
	"strings"

	"github.com/c65llc/starboard/internal/flows"
)

// Flow formats a flow document. Its front matter, when it is opened and
// closed with ---, gets its keys in canonical order (id, title, status,
// actors, entry, platforms, then any others) and the same YAML layout as
// the other files. Every line loses its trailing spaces and tabs (the
// whitespace the front matter delimiter and fences allow), except that a
// Markdown hard break outside a fence keeps two spaces; outside fenced
// blocks, runs of blank lines become one; blank lines at the end are
// dropped. The body is otherwise unchanged, Mermaid included. A leading
// byte order mark is dropped, CRLF becomes LF, and the file ends with a
// newline. It returns an error when the front matter is not readable YAML,
// or a line ends in a lone CR.
func Flow(src []byte) ([]byte, error) {
	text := strings.TrimPrefix(toLF(string(src)), flows.BOM)
	if strings.Contains(text, "\r") {
		return nil, errors.New("flow: lines must end in LF or CRLF, not a lone CR")
	}
	lines := strings.Split(text, "\n")
	var out []string
	if flows.IsDelimiter(lines[0]) {
		if end := closing(lines); end > 0 {
			fm, err := frontMatter([]byte(strings.Join(lines[1:end], "\n")))
			if err != nil {
				return nil, err
			}
			out = append(out, "---")
			if len(fm) > 0 {
				out = append(out, strings.Split(strings.TrimSuffix(string(fm), "\n"), "\n")...)
			}
			out = append(out, "---")
			lines = lines[end+1:]
		}
	}
	out = append(out, body(lines)...)
	// Every line is already trimmed (body keeps hard breaks on purpose), so
	// only trailing blank lines go.
	text = strings.TrimRight(strings.Join(out, "\n"), "\n")
	if text == "" {
		return []byte{}, nil
	}
	return []byte(text + "\n"), nil
}

// closing returns the index of the --- that closes the front matter, or -1.
func closing(lines []string) int {
	for i := 1; i < len(lines); i++ {
		if flows.IsDelimiter(lines[i]) {
			return i
		}
	}
	return -1
}

// body trims trailing spaces and tabs from every line and, outside fenced
// blocks, folds each run of blank lines into one. Outside fences, a line
// ending in two or more spaces before a line of text keeps exactly two: a
// Markdown hard break.
func body(lines []string) []string {
	var out []string
	fence := ""
	blank := false
	for i, raw := range lines {
		l := strings.TrimRight(raw, " \t")
		switch {
		case fence != "":
			if flows.IsFenceClose(l, fence) {
				fence = ""
			}
		case l == "":
			if blank {
				continue
			}
			blank = true
			out = append(out, l)
			continue
		default:
			if f, _, ok := flows.OpenFence(l); ok {
				fence = f
			} else if hardBreak(raw) && i+1 < len(lines) && strings.TrimSpace(lines[i+1]) != "" {
				l += "  "
			}
		}
		blank = false
		out = append(out, l)
	}
	return out
}

// hardBreak reports whether line ends in two or more spaces.
func hardBreak(line string) bool {
	return strings.HasSuffix(line, "  ")
}
