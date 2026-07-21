// Package protocol implements Specter's one-way runtime-observability protocol.
package protocol

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/devagrawal09/specter/runtimes/go/specter"
)

const Version = 1

type Envelope struct {
	ProtocolVersion int    `json:"protocolVersion"`
	Kind            string `json:"kind"`
	RequestID       string `json:"requestId"`
}

type RuntimeSource struct {
	Application     string `json:"application"`
	Environment     string `json:"environment"`
	RuntimeLanguage string `json:"runtimeLanguage"`
	RuntimeVersion  string `json:"runtimeVersion"`
	InstanceID      string `json:"instanceId"`
	EventLogID      string `json:"eventLogId"`
}

type RuntimeObservation struct {
	specter.Observation
	Sequence int64         `json:"sequence"`
	Source   RuntimeSource `json:"source"`

	decoded         bool
	timestampsValid bool
	causalityValid  bool
	typesValid      bool
}

func (observation *RuntimeObservation) UnmarshalJSON(data []byte) error {
	type alias RuntimeObservation
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var raw struct {
		ObservedAt json.RawMessage              `json:"observedAt"`
		Events     []map[string]json.RawMessage `json:"events"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	timestampsValid := isUTCDateTime(raw.ObservedAt)
	typesValid := true
	for _, event := range raw.Events {
		timestampsValid = timestampsValid && isUTCDateTime(event["recordedAt"])
		typesValid = typesValid && rawInteger(event, "order", true) && rawInteger(event, "commitVersion", true)
		if attributes, present := event["attributes"]; present {
			typesValid = typesValid && rawObject(attributes)
		}
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	typesValid = typesValid && rawInteger(fields, "sequence", true) && rawObject(fields["source"])
	for _, name := range []string{"cursor", "droppedCount", "version"} {
		typesValid = typesValid && rawInteger(fields, name, false)
	}
	for _, name := range []string{"parentOperationIds", "triggeringEventIds", "events"} {
		if value, present := fields[name]; present {
			typesValid = typesValid && rawArray(value)
		}
	}
	for _, name := range []string{"attributes", "error"} {
		if value, present := fields[name]; present {
			typesValid = typesValid && rawObject(value)
		}
	}
	if value, present := fields["duplicate"]; present {
		var boolean bool
		typesValid = typesValid && string(value) != "null" && json.Unmarshal(value, &boolean) == nil
	}
	if value, present := fields["triggeringEventOrder"]; present {
		var order map[string]json.RawMessage
		if !rawObject(value) || json.Unmarshal(value, &order) != nil {
			typesValid = false
		} else {
			typesValid = typesValid && rawInteger(order, "from", true) && rawInteger(order, "to", true)
		}
	}
	causalityValid := true
	for _, name := range []string{
		"correlationId", "reactionPassId", "deliveryId", "attemptId",
		"commandType", "queryType", "reaction", "slice", "reactionTicketId", "outcome",
	} {
		if value, present := fields[name]; present {
			var id string
			if err := json.Unmarshal(value, &id); err != nil || id == "" {
				causalityValid = false
			}
		}
	}
	*observation = RuntimeObservation(decoded)
	observation.decoded = true
	observation.timestampsValid = timestampsValid
	observation.causalityValid = causalityValid
	observation.typesValid = typesValid
	return nil
}

type RuntimeObservationBatch struct {
	Envelope
	Observations []RuntimeObservation `json:"observations"`

	decoded     bool
	fieldsValid bool
}

func (batch *RuntimeObservationBatch) UnmarshalJSON(data []byte) error {
	type alias RuntimeObservationBatch
	var decoded alias
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	raw, present := fields["observations"]
	fieldsValid := present && rawArray(raw)
	if !fieldsValid {
		delete(fields, "observations")
		var err error
		data, err = json.Marshal(fields)
		if err != nil {
			return err
		}
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*batch = RuntimeObservationBatch(decoded)
	batch.decoded = true
	batch.fieldsValid = fieldsValid
	return nil
}

type ObservationAcknowledgement struct {
	Envelope
	Accepted               int            `json:"accepted"`
	Duplicates             int            `json:"duplicates"`
	RejectedObservationIDs []string       `json:"rejectedObservationIds,omitempty"`
	Error                  *specter.Error `json:"error,omitempty"`
}

func rawInteger(fields map[string]json.RawMessage, name string, required bool) bool {
	raw, present := fields[name]
	if !present {
		return !required
	}
	if strings.TrimSpace(string(raw)) == "null" {
		return false
	}
	var value int64
	return json.Unmarshal(raw, &value) == nil
}

func rawArray(raw json.RawMessage) bool {
	value := strings.TrimSpace(string(raw))
	return len(value) > 0 && value[0] == '['
}

func rawObject(raw json.RawMessage) bool {
	value := strings.TrimSpace(string(raw))
	return len(value) > 0 && value[0] == '{'
}

func isUTCDateTime(raw json.RawMessage) bool {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || !strings.HasSuffix(value, "Z") {
		return false
	}
	_, err := time.Parse(time.RFC3339Nano, value)
	return err == nil
}
