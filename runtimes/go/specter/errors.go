package specter

import "fmt"

// ErrorCode is a stable, transport-safe Specter failure classification.
type ErrorCode string

const (
	ErrCommandRejected         ErrorCode = "SPECTER_COMMAND_REJECTED"
	ErrConformanceFailed       ErrorCode = "SPECTER_CONFORMANCE_FAILED"
	ErrIdempotencyConflict     ErrorCode = "SPECTER_IDEMPOTENCY_CONFLICT"
	ErrInfrastructure          ErrorCode = "SPECTER_INFRASTRUCTURE_FAILURE"
	ErrInvalidInput            ErrorCode = "SPECTER_INVALID_INPUT"
	ErrInvalidOutput           ErrorCode = "SPECTER_INVALID_OUTPUT"
	ErrReactionFailure         ErrorCode = "SPECTER_REACTION_FAILURE"
	ErrReactionTicketNotFound  ErrorCode = "SPECTER_REACTION_TICKET_NOT_FOUND"
	ErrUnknownCommand          ErrorCode = "SPECTER_UNKNOWN_COMMAND"
	ErrUnknownEvent            ErrorCode = "SPECTER_UNKNOWN_EVENT"
	ErrUnknownQuery            ErrorCode = "SPECTER_UNKNOWN_QUERY"
	ErrVersionConflict         ErrorCode = "SPECTER_VERSION_CONFLICT"
	ErrProtocolVersionMismatch ErrorCode = "SPECTER_PROTOCOL_VERSION_MISMATCH"
	ErrInvalidMessage          ErrorCode = "SPECTER_INVALID_MESSAGE"
	ErrInvalidJSON             ErrorCode = "SPECTER_INVALID_JSON"
)

// Error is the public failure shape shared by the in-process and HTTP APIs.
type Error struct {
	Code    ErrorCode      `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
	Cause   error          `json:"-"`
}

func (e *Error) Error() string { return e.Message }
func (e *Error) Unwrap() error { return e.Cause }

func newError(code ErrorCode, message string, details map[string]any, cause error) *Error {
	return &Error{Code: code, Message: message, Details: details, Cause: cause}
}

func unknownCommand(name string) *Error {
	return newError(ErrUnknownCommand, fmt.Sprintf("Unknown Command Slice: %q.", name), map[string]any{"commandType": name}, nil)
}

func unknownQuery(name string) *Error {
	return newError(ErrUnknownQuery, fmt.Sprintf("Unknown Query Slice: %q.", name), map[string]any{"queryType": name}, nil)
}
