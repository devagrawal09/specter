package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"sync"
	"syscall"
	"time"

	"github.com/devagrawal09/specter/runtimes/go/protocol"
	"github.com/devagrawal09/specter/runtimes/go/specter"
	"github.com/devagrawal09/specter/runtimes/go/telemetry"
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
	collectorURL := os.Getenv("SPECTER_COLLECTOR_URL")
	if collectorURL == "" {
		collectorURL = "http://127.0.0.1:41736/specter/v1"
	}
	producer := telemetry.NewProducer(&protocol.Client{BaseURL: collectorURL}, protocol.RuntimeSource{Application: "go-todo-reference", Environment: environment(), RuntimeLanguage: "go", RuntimeVersion: "0.1.0", InstanceID: fmt.Sprintf("go-todo-%d", time.Now().UnixNano()), EventLogID: "go-todo-memory"}, telemetry.DefaultQueueCapacity)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = producer.Close(ctx)
	}()
	app, err := newTodoApp(producer.Observe)
	if err != nil {
		log.Fatal(err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = app.Close(ctx)
	}()
	server := &http.Server{Addr: address, Handler: (&protocol.Server{App: app, RuntimeVersion: "0.1.0"}).Handler(), ReadHeaderTimeout: 5 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("Go Todo Specter protocol server listening on http://%s", address)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func environment() string {
	if value := os.Getenv("SPECTER_ENVIRONMENT"); value != "" {
		return value
	}
	return "development"
}

func newTodoApp(observe specter.Observer) (*specter.App, error) {
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
	return specter.NewApp(specter.Config{Events: []string{"todo-added"}, EventLog: specter.NewMemoryEventLog(), Commands: []specter.CommandDefinition{command}, Queries: []specter.QueryDefinition{query}, Observe: observe})
}
