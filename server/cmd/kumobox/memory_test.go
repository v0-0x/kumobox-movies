package main

import "testing"

func TestMemoryLimit(t *testing.T) {
	cases := []struct {
		name    string
		env     map[string]string
		want    int64
		wantErr bool
	}{
		{"default", nil, defaultMemoryLimitMB << 20, false},
		{"set", map[string]string{"KUMOBOX_MEMORY_LIMIT_MB": "512"}, 512 << 20, false},
		{"off", map[string]string{"KUMOBOX_MEMORY_LIMIT_MB": "0"}, 0, false},
		{"spaces", map[string]string{"KUMOBOX_MEMORY_LIMIT_MB": " 128 "}, 128 << 20, false},
		{"not a number", map[string]string{"KUMOBOX_MEMORY_LIMIT_MB": "lots"}, defaultMemoryLimitMB << 20, true},
		{"negative", map[string]string{"KUMOBOX_MEMORY_LIMIT_MB": "-1"}, defaultMemoryLimitMB << 20, true},
		{"GOMEMLIMIT wins", map[string]string{"GOMEMLIMIT": "1GiB", "KUMOBOX_MEMORY_LIMIT_MB": "512"}, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := memoryLimit(func(k string) string { return c.env[k] })
			if got != c.want || (err != nil) != c.wantErr {
				t.Errorf("memoryLimit = %d, %v; want %d (error: %v)", got, err, c.want, c.wantErr)
			}
		})
	}
}
