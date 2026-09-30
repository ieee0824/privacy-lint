package jev

import (
	"bytes"
	"sync"
	"testing"
)

func TestQuestionResultsDoNotShareTemplateData(t *testing.T) {
	w := website()
	input := mustJSON(w)
	baseline := mustJSON(QuestionsFor(w))
	first := QuestionsFor(w)
	mutateQuestions(first)
	if !bytes.Equal(baseline, mustJSON(QuestionsFor(w))) {
		t.Fatal("returned instructions or criteria changed the fixed template")
	}
	if !bytes.Equal(input, mustJSON(w)) {
		t.Fatal("question selection changed the website input")
	}
}

func TestConcurrentQuestionResultsHaveIndependentData(t *testing.T) {
	w := website()
	baseline := mustJSON(QuestionsFor(w))
	var workers sync.WaitGroup
	for range 50 {
		workers.Go(func() {
			for range 20 {
				questions := QuestionsFor(w)
				if !bytes.Equal(baseline, mustJSON(questions)) {
					t.Error("another call changed the template")
				}
				mutateQuestions(questions)
			}
		})
	}
	workers.Wait()
	if !bytes.Equal(baseline, mustJSON(QuestionsFor(w))) {
		t.Fatal("concurrent mutation changed shared question data")
	}
}

func mutateQuestions(questions map[string]Question) {
	for _, question := range questions {
		question.Instructions.(map[string]any)["rules"] = "changed by caller"
		switch criteria := question.Criteria.(type) {
		case map[string]string:
			criteria["true"] = "changed by caller"
		case []string:
			criteria[0] = "changed by caller"
		}
	}
}

func TestCopyQuestionValueSeparatesNestedMapsAndSlices(t *testing.T) {
	value := map[string]any{"nested": []any{map[string]any{"text": "fixed"}}}
	copy := copyQuestionValue(value).(map[string]any)
	copy["nested"].([]any)[0].(map[string]any)["text"] = "changed"
	if value["nested"].([]any)[0].(map[string]any)["text"] != "fixed" {
		t.Fatal("nested mutable values are shared")
	}
}
