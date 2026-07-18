package protocol_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/devagrawal09/specter/runtimes/go/protocol"
)

func TestGoClientAgainstTypeScriptRuntime(t *testing.T) {
	baseURL := os.Getenv("SPECTER_TYPESCRIPT_PROTOCOL_URL")
	if baseURL == "" {
		t.Skip("SPECTER_TYPESCRIPT_PROTOCOL_URL is not configured")
	}
	client := &protocol.Client{BaseURL: baseURL}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	capabilities, err := client.Capabilities(ctx, protocol.CapabilitiesRequest{
		Required: []string{protocol.CapabilityCommands, protocol.CapabilityQueries},
	})
	if err != nil {
		t.Fatal(err)
	}
	if capabilities.Runtime.Language != "typescript" {
		t.Fatalf("unexpected runtime: %#v", capabilities.Runtime)
	}

	todoID := fmt.Sprintf("go-client-%d", time.Now().UnixNano())
	command, err := client.Command(ctx, protocol.CommandRequest{
		OperationID:    "command-" + todoID,
		IdempotencyKey: todoID,
		Command: protocol.OperationEnvelope{
			Type:    "addTodo",
			Payload: json.RawMessage(fmt.Sprintf(`{"todoId":%q,"title":"Across runtimes"}`, todoID)),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if command.Status != "committed" {
		t.Fatalf("unexpected Command response: %#v", command)
	}
	query, err := client.Query(ctx, protocol.QueryRequest{
		OperationID: "query-" + todoID,
		Query: protocol.OperationEnvelope{
			Type:    "todosQuery",
			Payload: json.RawMessage(`{"status":"all"}`),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if query.Result == nil {
		t.Fatal("TypeScript Query returned no result")
	}
}
