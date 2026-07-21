package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTodoProjectAPIExecutesRuntimeCommandsAndQueries(t *testing.T) {
	app, err := newTodoApp(nil)
	if err != nil {
		t.Fatal(err)
	}
	defer closeApp(t, app)
	server := httptest.NewServer(newTodoHandler(app))
	defer server.Close()

	request, err := http.NewRequest(http.MethodPost, server.URL+"/todos", strings.NewReader(`{"todoId":"todo-1","title":"Project owned"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "todo-1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("POST /todos returned HTTP %d", response.StatusCode)
	}
	var command struct {
		OperationID string `json:"operationId"`
		Status      string `json:"status"`
		Version     int64  `json:"version"`
	}
	if err := json.NewDecoder(response.Body).Decode(&command); err != nil {
		t.Fatal(err)
	}
	if command.OperationID == "" || command.Status != "committed" || command.Version != 1 {
		t.Fatalf("unexpected Command response: %#v", command)
	}

	response, err = http.Get(server.URL + "/todos")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET /todos returned HTTP %d", response.StatusCode)
	}
	var todos []todo
	if err := json.NewDecoder(response.Body).Decode(&todos); err != nil {
		t.Fatal(err)
	}
	if len(todos) != 1 || todos[0].TodoID != "todo-1" || todos[0].Title != "Project owned" {
		t.Fatalf("unexpected Todos: %#v", todos)
	}
}

func TestTodoProjectAPIPreservesIdempotency(t *testing.T) {
	app, err := newTodoApp(nil)
	if err != nil {
		t.Fatal(err)
	}
	defer closeApp(t, app)
	server := httptest.NewServer(newTodoHandler(app))
	defer server.Close()

	for attempt, wantStatus := range []int{http.StatusCreated, http.StatusOK} {
		request, err := http.NewRequest(http.MethodPost, server.URL+"/todos", strings.NewReader(`{"todoId":"todo-1","title":"Once"}`))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Idempotency-Key", "todo-1")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Status string `json:"status"`
		}
		if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
			response.Body.Close()
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != wantStatus {
			t.Fatalf("attempt %d returned HTTP %d, want %d", attempt+1, response.StatusCode, wantStatus)
		}
		if attempt == 1 && result.Status != "duplicate" {
			t.Fatalf("duplicate request returned status %q", result.Status)
		}
	}
}

func TestTodoProjectAPIDoesNotExposeOperationalProtocolRoutes(t *testing.T) {
	app, err := newTodoApp(nil)
	if err != nil {
		t.Fatal(err)
	}
	defer closeApp(t, app)
	handler := newTodoHandler(app)
	for _, path := range []string{
		"/specter/v1/capabilities",
		"/specter/v1/commands",
		"/specter/v1/queries",
		"/specter/v1/subscriptions",
		"/specter/v1/reaction-tickets/ticket-1",
		"/specter/v1/observations",
	} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s returned HTTP %d, want 404", path, response.Code)
		}
	}
}

func TestTodoProjectAPIRejectsUnknownInputFields(t *testing.T) {
	app, err := newTodoApp(nil)
	if err != nil {
		t.Fatal(err)
	}
	defer closeApp(t, app)
	request := httptest.NewRequest(http.MethodPost, "/todos", strings.NewReader(`{"todoId":"todo-1","title":"Todo","unexpected":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	newTodoHandler(app).ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("got HTTP %d: %s", response.Code, response.Body.String())
	}
}

func closeApp(t *testing.T, app interface {
	Close(context.Context) error
}) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := app.Close(ctx); err != nil {
		t.Error(err)
	}
}
