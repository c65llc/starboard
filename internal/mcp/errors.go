// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

package mcp

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/c65llc/starboard/core"
	"github.com/c65llc/starboard/internal/project"
)

// Error results are not fenced, so their text must never carry project
// content: a screens.yaml key, a flow file name or a YAML parser's quote
// of a line could hold instructions. Only messages the server wrote, which
// quote at most the caller's own arguments, reach the model as they are;
// every other error is replaced by a fixed sentence for its kind. The
// audit line keeps the original, for the person reading the log.

// toolError is a message the server wrote for the caller.
type toolError string

func (e toolError) Error() string { return string(e) }

// failf is a toolError.
func failf(format string, args ...any) error { return toolError(fmt.Sprintf(format, args...)) }

// public is the text of err that may go to the model.
func public(err error) string {
	var te toolError
	switch {
	case errors.As(err, &te):
		return te.Error()
	case errors.Is(err, project.ErrNoProject):
		return "no starboard.yaml found in the project directory; run `starboard init` there, then restart the server"
	case errors.Is(err, core.ErrUnknownScreen):
		return "that screen is not registered; starboard_query lists the screens"
	case errors.Is(err, core.ErrUnknownFlow):
		return "that flow does not exist; starboard_query lists the flows"
	case errors.Is(err, core.ErrUnknownFormFactor):
		return "unknown form factor; starboard_screen_get lists the screen's formFactors"
	case errors.Is(err, core.ErrNoFormFactor):
		return "the screen has no form factor of its own; pass formFactor"
	case errors.Is(err, core.ErrNotLoaded):
		return "a file the edit needs does not parse; starboard_lint reports why: fix it, then retry"
	case errors.Is(err, core.ErrBadEdit), errors.Is(err, core.ErrBadPath):
		return badEdit(err)
	}
	return "the server could not read or write the project's files; check that the project directory is readable and writable, then retry"
}

// badEdit is the text of an edit core.Edit could not apply. Most quote
// only the caller's own ID, key or value; the few that quote a file, a
// parser or an encoder are replaced.
func badEdit(err error) string {
	msg := err.Error()
	if _, rest, ok := strings.Cut(msg, "): "); ok && strings.HasPrefix(msg, "op ") {
		msg = rest // drop "op N (name): ", which names an op the caller never wrote
	}
	switch {
	case strings.Contains(msg, "cannot be formatted"), strings.Contains(msg, "yaml:"):
		return "the edited file cannot be written in canonical form; check the values you set, or run starboard_lint"
	case strings.HasSuffix(msg, " already exists") && !strings.Contains(msg, ": screen ") && !strings.Contains(msg, ": flow "):
		return "a file already exists where that flow would go; choose another flow ID"
	}
	return msg
}

// argsError is the text for arguments that do not decode: the argument
// named, never Go's type names.
func argsError(err error) error {
	var typeErr *json.UnmarshalTypeError
	msg := err.Error()
	switch {
	case errors.As(err, &typeErr) && typeErr.Field != "":
		return failf("invalid arguments: %s has the wrong type; tools/list gives each tool's input schema", typeErr.Field)
	case strings.HasPrefix(msg, "json: unknown field "):
		return failf("invalid arguments: unknown argument %s; tools/list gives each tool's input schema", strings.TrimPrefix(msg, "json: unknown field "))
	}
	return failf("invalid arguments: they must be a JSON object; tools/list gives each tool's input schema")
}
