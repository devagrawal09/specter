// Command observation-fixture submits one Go runtime observation to a
// collector. It is used by the cross-language collector integration test.
package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/devagrawal09/specter/runtimes/go/protocol"
	"github.com/devagrawal09/specter/runtimes/go/specter"
)

func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: observation-fixture <collector-url>")
	}
	client := &protocol.ObservationClient{
		BaseURL: strings.TrimRight(os.Args[1], "/") + "/specter/v1",
	}
	acknowledgement, err := client.SendObservations(
		context.Background(),
		protocol.RuntimeObservationBatch{
			Envelope: protocol.Envelope{RequestID: "go-interop-request"},
			Observations: []protocol.RuntimeObservation{{
				Observation: specter.Observation{
					ObservationID: "go-interop-observation",
					Kind:          "command.completed",
					ObservedAt:    time.Now().UTC(),
					OperationID:   "go-interop-operation",
					CommandType:   "addTodo",
					Outcome:       "succeeded",
				},
				Sequence: 1,
				Source: protocol.RuntimeSource{
					Application:     "go-interop",
					Environment:     "test",
					RuntimeLanguage: "go",
					RuntimeVersion:  "test",
					InstanceID:      "go-interop-instance",
					EventLogID:      "go-interop-log",
				},
			}},
		},
	)
	if err != nil {
		log.Fatal(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(acknowledgement); err != nil {
		log.Fatal(err)
	}
}
