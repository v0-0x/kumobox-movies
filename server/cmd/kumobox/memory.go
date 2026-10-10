package main

import (
	"fmt"
	"log"
	"runtime/debug"
	"strconv"
	"strings"
)

// defaultMemoryLimitMB is the server's soft memory limit. KumoBox's heap is
// normally a few tens of megabytes; the limit only matters after a burst
// (a scan of a huge library, many providers at once), when the garbage
// collector then works harder instead of letting the heap balloon.
const defaultMemoryLimitMB = 256

// defaultGCPercent is the garbage collector's GOGC. Go's default (100)
// lets the heap grow to twice what's in use before collecting; KumoBox's
// heap is small and mostly idle, so collecting at 1.5 times costs little
// CPU and keeps 10-15 MB less in memory.
const defaultGCPercent = 50

// limitMemory applies the soft memory limit: KUMOBOX_MEMORY_LIMIT_MB
// (0 turns it off) or defaultMemoryLimitMB. GOMEMLIMIT, when set, is left
// to the Go runtime, and so is GOGC.
func limitMemory(getenv func(string) string) {
	limit, err := memoryLimit(getenv)
	if err != nil {
		log.Print(err)
	}
	if limit > 0 {
		debug.SetMemoryLimit(limit)
	}
	if getenv("GOGC") == "" {
		debug.SetGCPercent(defaultGCPercent)
	}
}

// memoryLimit is the limit to set in bytes, 0 for none.
func memoryLimit(getenv func(string) string) (int64, error) {
	if getenv("GOMEMLIMIT") != "" {
		return 0, nil
	}
	mb := int64(defaultMemoryLimitMB)
	if v := strings.TrimSpace(getenv("KUMOBOX_MEMORY_LIMIT_MB")); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 || n > 1<<20 {
			return mb << 20, fmt.Errorf("KUMOBOX_MEMORY_LIMIT_MB=%q is not a number of megabytes: using %d", v, mb)
		}
		mb = n
	}
	return mb << 20, nil
}
