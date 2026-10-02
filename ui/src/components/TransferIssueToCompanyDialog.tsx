import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { issuesApi } from "../api/issues";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useToastActions } from "../context/ToastContext";
import { normalizeCompanyPrefix } from "../lib/company-routes";
import { queryKeys } from "../lib/queryKeys";

/**
 * The companies this board user can hand a task to: every company they belong
 * to except the one the task already lives in, minus archived ones.
 */
export function useTransferTargetCompanies(sourceCompanyId: string | null | undefined) {
  const { companies } = useCompany();
  return companies.filter(
    (company) => company.id !== sourceCompanyId && company.status !== "archived",
  );
}

export function TransferIssueToCompanyDialog({
  open,
  onOpenChange,
  issue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: { id: string; identifier?: string | null; title?: string | null; companyId: string };
}) {
  const { pushToast } = useToastActions();
  const targetCompanies = useTransferTargetCompanies(issue.companyId);
  const [targetCompanyId, setTargetCompanyId] = useState<string>("");
  const [targetProjectId, setTargetProjectId] = useState<string>("");

  // Reopening the dialog should not inherit the previous run's selection.
  useEffect(() => {
    if (!open) return;
    setTargetCompanyId("");
    setTargetProjectId("");
  }, [open]);

  const projectsQuery = useQuery({
    queryKey: targetCompanyId
      ? queryKeys.projects.list(targetCompanyId)
      : ["projects", "transfer-target", "none"],
    queryFn: () => projectsApi.list(targetCompanyId),
    enabled: open && Boolean(targetCompanyId),
  });
  const projects = (projectsQuery.data ?? []).filter((project) => !project.archivedAt);

  const targetCompany = targetCompanies.find((company) => company.id === targetCompanyId) ?? null;
  const targetProject = projects.find((project) => project.id === targetProjectId) ?? null;

  const transfer = useMutation({
    mutationFn: () =>
      issuesApi.transferToCompany(issue.id, { targetCompanyId, targetProjectId }),
    onSuccess: (created) => {
      const label = created.identifier ?? "the new task";
      pushToast({
        title: `Sent to ${targetCompany?.name ?? "the other company"}`,
        body: `${label} was created${targetProject ? ` in ${targetProject.name}` : ""}.`,
        tone: "success",
        ...(created.identifier && targetCompany
          ? {
              action: {
                label: created.identifier,
                href: `/${normalizeCompanyPrefix(targetCompany.issuePrefix)}/issues/${created.identifier}`,
              },
            }
          : {}),
      });
      onOpenChange(false);
    },
  });

  const pending = transfer.isPending;
  const ready = Boolean(targetCompanyId && targetProjectId) && !pending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!pending} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send to another company</DialogTitle>
          <DialogDescription>
            Copies the title, description and named documents into a new task. This task
            stays where it is, linked to the copy.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Company</span>
            <Select
              value={targetCompanyId}
              disabled={pending}
              onValueChange={(value) => {
                setTargetCompanyId(value);
                setTargetProjectId("");
                transfer.reset();
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a company" />
              </SelectTrigger>
              <SelectContent>
                {targetCompanies.map((company) => (
                  <SelectItem key={company.id} value={company.id}>
                    {company.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Project</span>
            <Select
              value={targetProjectId}
              disabled={pending || !targetCompanyId || projectsQuery.isLoading}
              onValueChange={(value) => {
                setTargetProjectId(value);
                transfer.reset();
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    !targetCompanyId
                      ? "Choose a company first"
                      : projectsQuery.isLoading
                        ? "Loading…"
                        : projects.length === 0
                          ? "No projects in this company"
                          : "Choose a project"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {targetCompany && targetProject ? (
            <p className="rounded border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-mono">{issue.identifier ?? issue.id}</span>
              {issue.title ? ` — ${issue.title}` : ""} will be copied into{" "}
              <span className="text-foreground">{targetCompany.name}</span> /{" "}
              <span className="text-foreground">{targetProject.name}</span>.
            </p>
          ) : null}

          {transfer.error ? (
            <p role="alert" className="text-sm text-destructive">
              {transfer.error instanceof Error
                ? transfer.error.message
                : "Could not send this task."}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => transfer.mutate()}>
            {pending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
