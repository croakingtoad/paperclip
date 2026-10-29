#!/bin/bash
set -e

REPO_DIR="/home/marty/.paperclip/instances/default/projects/500b810a-efea-49f2-b3a2-63d910fb5277/06cbe2ac-3c19-41c9-87e1-93ffa065560b/paperclip"
LOG_FILE="$REPO_DIR/.daily-sync.log"
BRANCHES=("loc-645/fix-harness-connection-sync" "loc-687/preserve-harness-aiconnection")

cd "$REPO_DIR"

{
  echo "=== Daily Upstream Sync Started at $(date) ==="

  # Fetch upstream
  echo "Fetching upstream/master..."
  git fetch upstream master

  # Merge upstream into fork's master
  echo "Merging upstream/master into fork..."
  git checkout master
  if git merge --no-edit upstream/master; then
    echo "✅ Master merged successfully"
  else
    echo "⚠️ Merge conflict detected"
    git merge --abort
    echo "❌ Merge aborted due to conflicts. Manual review needed."
    exit 1
  fi

  # Rebase feature branches
  for branch in "${BRANCHES[@]}"; do
    echo ""
    echo "Processing branch: $branch"
    if git rev-parse --verify "$branch" >/dev/null 2>&1; then
      if git checkout "$branch"; then
        echo "Rebasing $branch on master..."
        if git rebase master; then
          echo "✅ $branch rebased successfully"
        else
          echo "⚠️ Rebase conflict in $branch, aborting..."
          git rebase --abort
          echo "❌ Rebase aborted for $branch. Manual review needed."
          exit 1
        fi
      else
        echo "❌ Failed to checkout $branch"
        exit 1
      fi
    else
      echo "⚠️ Branch $branch does not exist locally"
    fi
  done

  echo ""
  echo "=== Daily Upstream Sync Completed Successfully at $(date) ==="

} | tee -a "$LOG_FILE"
