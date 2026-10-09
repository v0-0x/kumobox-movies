// The building blocks of the Settings pages.
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronDown, Eye, EyeOff, Folder, FolderOpen, HardDrive, Plus, X } from "lucide-react"
import { useEffect, useState } from "react"
import { Badge, Button, Dialog, Input, Textarea } from "@/components/ui"
import { api } from "@/lib/api"
import { useStatus } from "@/lib/queries"
import type { Settings } from "@/lib/types"
import { cn } from "@/lib/utils"

export type SectionProps = { draft: Settings; set: <K extends keyof Settings>(k: K, v: Partial<Settings[K]>) => void }

// ---------------------------------------------------------------------------
// Layout helpers

export function Group({ title, children, description }: { title?: string; description?: string; children: React.ReactNode }) {
    return (
        <div>
            {title && <h3 className="mb-1 text-[15px] font-semibold">{title}</h3>}
            {description && <p className="mb-3 text-[13px] text-muted">{description}</p>}
            {!description && title && <div className="mb-3" />}
            <div className="card divide-y divide-line">{children}</div>
        </div>
    )
}

// wide: the value (e.g. a long path) takes the remaining space and wraps
// instead of pushing out of the card.
export function Row({ label, help, children, wide }: { label: React.ReactNode; help?: React.ReactNode; children: React.ReactNode; wide?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-6 px-4 py-3.5">
            <div className="min-w-0">
                <p className="text-sm font-medium">{label}</p>
                {help && <p className="mt-0.5 text-xs text-subtle">{help}</p>}
            </div>
            <div className={wide ? "flex min-w-0 flex-1 justify-end" : "shrink-0"}>{children}</div>
        </div>
    )
}

export function Stack({ label, help, children }: { label: React.ReactNode; help?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-2 px-4 py-3.5">
            <p className="text-sm font-medium">{label}</p>
            {children}
            {help && <p className="text-xs text-subtle">{help}</p>}
        </div>
    )
}

export function Password({ value, onChange, placeholder, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
    const [show, setShow] = useState(false)
    return (
        <div className="relative">
            <Input type={show ? "text" : "password"} value={value} placeholder={placeholder} disabled={disabled} onChange={e => onChange(e.target.value)} className="pr-10" />
            <button
                type="button"
                onClick={() => setShow(s => !s)}
                aria-label={show ? "Hide" : "Show"}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-subtle hover:text-fg"
            >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
        </div>
    )
}

// Whether this page is open on another device of the network: settings
// about this computer's programs, folders, accounts and network are kept as
// they are when it saves (the server's saveSettings), so their fields are
// disabled.
export function useLan() {
    const { data: status } = useStatus()
    return status?.client === "lan"
}

// Said under those fields on a device of the network.
export function LanOnly() {
    return <p className="px-4 py-3 text-xs text-amber-200/80">Changed on the computer KumoBox runs on.</p>
}

export function Collapsible({ title, children }: { title: string; children: React.ReactNode }) {
    const [open, setOpen] = useState(false)
    return (
        <div className="card">
            <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between px-4 py-3.5 text-[15px] font-medium">
                {title}
                <ChevronDown className={cn("size-4 text-muted transition-transform duration-200", open && "rotate-180")} />
            </button>
            {open && <div className="divide-y divide-line border-t border-line">{children}</div>}
        </div>
    )
}

export function DirPicker({ open, onOpenChange, onPick, start }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (p: string) => void; start?: string }) {
    const [path, setPath] = useState(start ?? "")
    const { data, error } = useQuery({
        queryKey: ["dirs", path],
        // roots: the drives on Windows.
        queryFn: () => api.get<{ path: string; parent: string; dirs: string[]; sep?: string; roots?: string[] | null }>(`/api/fs/dirs?path=${encodeURIComponent(path)}`),
        enabled: open,
    })
    useEffect(() => {
        if (open) setPath(start ?? "")
    }, [open, start])
    return (
        <Dialog
            open={open}
            onOpenChange={onOpenChange}
            title="Choose a folder"
            className="w-[min(94vw,620px)]"
            footer={
                <Button
                    variant="primary"
                    onClick={() => {
                        if (data) onPick(data.path)
                        onOpenChange(false)
                    }}
                >
                    Use this folder
                </Button>
            }
        >
            <Input value={data?.path ?? path} onChange={e => setPath(e.target.value)} onKeyDown={e => e.key === "Enter" && setPath((e.target as HTMLInputElement).value)} icon={<Folder className="size-4" />} />
            {error && <p className="mt-2 text-sm text-rose-300">{(error as Error).message}</p>}
            {!!data?.roots?.length && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {data.roots.map(r => (
                        <Button key={r} size="xs" variant={data.path.toLowerCase().startsWith(r.toLowerCase()) ? "primary" : "subtle"} icon={<HardDrive className="size-3.5" />} onClick={() => setPath(r)}>
                            {r.replace(/\\$/, "")}
                        </Button>
                    ))}
                </div>
            )}
            <div className="mt-3 flex max-h-80 flex-col overflow-y-auto">
                {data && data.parent !== data.path && (
                    <button onClick={() => setPath(data.parent)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-white/[0.05]">
                        <FolderOpen className="size-4" /> ..
                    </button>
                )}
                {data?.dirs.map(d => (
                    <button
                        key={d}
                        onClick={() => setPath(`${data.path.replace(/[\\/]$/, "")}${data.sep ?? "/"}${d}`)}
                        className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/[0.05]"
                    >
                        <Folder className="size-4 text-brand-strong" /> {d}
                    </button>
                ))}
            </div>
        </Dialog>
    )
}

export function PathInput({ value, onChange, placeholder, disabled }: { value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
    const [open, setOpen] = useState(false)
    const { data: status } = useStatus()
    return (
        <div className="flex items-center gap-2">
            <div className="relative flex-1">
                <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} icon={<Folder className="size-4 text-amber-300" />} />
                {value && <Check className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-emerald-400" />}
            </div>
            {status?.client !== "lan" && !disabled && (
                <button onClick={() => setOpen(true)} className="grid size-10 place-items-center rounded-xl text-muted hover:bg-white/[0.06] hover:text-fg" aria-label="Browse">
                    <FolderOpen className="size-5" />
                </button>
            )}
            <DirPicker open={open} onOpenChange={setOpen} onPick={onChange} start={value} />
        </div>
    )
}

const toLines = (text: string) => text.split("\n").map(s => s.trim()).filter(Boolean)

// One entry per line. The box keeps the text as typed (blank lines, spaces)
// and only the cleaned-up list goes into the draft, so typing is never
// rewritten under the cursor; leaving the box tidies it.
export function LinesInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
    const joined = value.join("\n")
    const [text, setText] = useState(joined)
    // The list was replaced from outside (Discard, a save, a change made elsewhere).
    useEffect(() => setText(t => (toLines(t).join("\n") === joined ? t : joined)), [joined])
    return (
        <Textarea
            value={text}
            onChange={e => {
                setText(e.target.value)
                onChange(toLines(e.target.value))
            }}
            onBlur={() => setText(joined)}
        />
    )
}

export function Detect({ ok, label }: { ok?: boolean; label: string }) {
    return ok ? <Badge tone="green">{label} found</Badge> : <Badge tone="red">{label} not found</Badge>
}

// A list of values (URLs…), an input each, with buttons to add and remove
// them.
export function ListInput({ value, onChange, placeholder, addLabel = "Add" }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; addLabel?: string }) {
    return (
        <div className="flex flex-col gap-2">
            {value.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                    <Input value={v} placeholder={placeholder} onChange={e => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} />
                    <button
                        onClick={() => onChange(value.filter((_, j) => j !== i))}
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.06] hover:text-rose-300"
                        aria-label="Remove"
                    >
                        <X className="size-4" />
                    </button>
                </div>
            ))}
            <div>
                <Button size="sm" variant="subtle" icon={<Plus className="size-4" />} onClick={() => onChange([...value, ""])}>
                    {addLabel}
                </Button>
            </div>
        </div>
    )
}

// A link out of KumoBox, in settings' help texts.
export function Ext({ href, children }: { href: string; children: React.ReactNode }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-strong hover:underline">
            {children}
        </a>
    )
}
