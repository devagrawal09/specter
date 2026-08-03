package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"sync"
	"syscall"
	"time"

	"github.com/devagrawal09/specter/runtimes/go/specter"
)

const address = "127.0.0.1:41737"

type addTodoInput struct {
	TodoID string `json:"todoId"`
	Title  string `json:"title"`
}
type todoAdded struct {
	TodoID string `json:"todoId"`
	Title  string `json:"title"`
}
type todo struct {
	TodoID string `json:"todoId"`
	Title  string `json:"title"`
}

func main() {
	app, err := newTodoApp()
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = app.Close(ctx)
	}()
	server := &http.Server{Addr: address, Handler: newTodoHandler(app), ReadHeaderTimeout: 5 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("Go Todo project API listening on http://%s", address)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func newTodoHandler(app *specter.App) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(writer http.ResponseWriter, _ *http.Request) {
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("POST /todos", func(writer http.ResponseWriter, request *http.Request) {
		var input addTodoInput
		if err := decodeJSON(writer, request, &input); err != nil {
			writeAPIError(writer, http.StatusBadRequest, "INVALID_REQUEST", "Request body must be a Todo JSON object.")
			return
		}
		execution, err := app.Command(request.Context(), "addTodo", input, specter.DispatchOptions{
			IdempotencyKey: request.Header.Get("Idempotency-Key"),
		})
		if err != nil {
			status, code, message := publicAPIError(err)
			writeAPIError(writer, status, code, message)
			return
		}
		status := http.StatusCreated
		outcome := "committed"
		if execution.Duplicate {
			status = http.StatusOK
			outcome = "duplicate"
		}
		writeJSON(writer, status, map[string]any{
			"status":  outcome,
			"version": execution.Version,
		})
	})
	mux.HandleFunc("GET /todos", func(writer http.ResponseWriter, request *http.Request) {
		result, err := app.Query(request.Context(), "todosQuery", struct{}{})
		if err != nil {
			writeAPIError(writer, http.StatusInternalServerError, "INTERNAL_ERROR", "Todos could not be loaded.")
			return
		}
		writeJSON(writer, http.StatusOK, result)
	})
	return mux
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, output any) error {
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return errors.New("Content-Type must be application/json")
	}
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON value")
	}
	return nil
}

func publicAPIError(err error) (int, string, string) {
	var failure *specter.Error
	if !errors.As(err, &failure) {
		return http.StatusInternalServerError, "INTERNAL_ERROR", "Todo operation failed."
	}
	switch failure.Code {
	case specter.ErrCommandRejected, specter.ErrInvalidInput:
		return http.StatusBadRequest, "TODO_REJECTED", "Todo could not be added."
	case specter.ErrIdempotencyConflict, specter.ErrVersionConflict:
		return http.StatusConflict, "TODO_CONFLICT", "Todo request conflicts with an earlier change."
	default:
		return http.StatusInternalServerError, "INTERNAL_ERROR", "Todo operation failed."
	}
}

func writeAPIError(writer http.ResponseWriter, status int, code, message string) {
	writeJSON(writer, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func newTodoApp() (*specter.App, error) {
	var commandMu sync.Mutex
	commandTodos := map[string]todo{}
	commandApply := map[string]specter.ApplyFunc{"todo-added": specter.DecodeApply(func(_ context.Context, payload todoAdded, _ specter.PersistedEvent) error {
		commandTodos[payload.TodoID] = todo{TodoID: payload.TodoID, Title: payload.Title}
		return nil
	})}
	commandScenarios := []specter.CommandScenario{
		{Description: "adds a Todo", Input: addTodoInput{TodoID: "todo-1", Title: "Ship it"}, Expect: []specter.ScenarioEvent{{Type: "todo-added", Payload: todoAdded{TodoID: "todo-1", Title: "Ship it"}}}},
		{Description: "rejects a duplicate Todo ID", Given: []specter.ScenarioEvent{{Type: "todo-added", Payload: todoAdded{TodoID: "todo-1", Title: "Existing"}}}, Input: addTodoInput{TodoID: "todo-1", Title: "Again"}, RejectReason: "Todo already exists"},
	}
	command := specter.CommandDefinition{Name: "addTodo", Apply: commandApply, Scenarios: commandScenarios, Handle: specter.DecodeCommand(func(_ context.Context, input addTodoInput) ([]specter.EventDraft, error) {
		commandMu.Lock()
		defer commandMu.Unlock()
		if input.TodoID == "" || input.Title == "" {
			return nil, specter.Reject("addTodo", "todoId and title are required")
		}
		if _, exists := commandTodos[input.TodoID]; exists {
			return nil, specter.Reject("addTodo", "Todo already exists")
		}
		return []specter.EventDraft{{Type: "todo-added", Payload: todoAdded{TodoID: input.TodoID, Title: input.Title}}}, nil
	})}
	var queryMu sync.Mutex
	queryTodos := map[string]todo{}
	query := specter.QueryDefinition{Name: "todosQuery", Apply: map[string]specter.ApplyFunc{"todo-added": specter.DecodeApply(func(_ context.Context, payload todoAdded, _ specter.PersistedEvent) error {
		queryMu.Lock()
		defer queryMu.Unlock()
		queryTodos[payload.TodoID] = todo{TodoID: payload.TodoID, Title: payload.Title}
		return nil
	})}, Scenarios: []specter.QueryScenario{{Description: "lists projected Todos", Given: []specter.ScenarioEvent{{Type: "todo-added", Payload: todoAdded{TodoID: "todo-1", Title: "Ship it"}}}, Input: struct{}{}, Expect: []todo{{TodoID: "todo-1", Title: "Ship it"}}}}, Handle: specter.DecodeQuery(func(_ context.Context, _ struct{}) ([]todo, error) {
		queryMu.Lock()
		defer queryMu.Unlock()
		result := make([]todo, 0, len(queryTodos))
		for _, item := range queryTodos {
			result = append(result, item)
		}
		sort.Slice(result, func(i, j int) bool { return result[i].TodoID < result[j].TodoID })
		return result, nil
	})}
	return specter.NewApp(specter.Config{Events: []string{"todo-added"}, EventLog: specter.NewMemoryEventLog(), Commands: []specter.CommandDefinition{command}, Queries: []specter.QueryDefinition{query}})
}
