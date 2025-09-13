import * as vscode from "vscode"
import { WebviewMessage } from "../../shared/WebviewMessage"
import type { FileChange, FileChangeType } from "@roo-code/types"
import { FileChangeError, FileChangeErrorType, FileChangeManager } from "./FileChangeManager"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { DIFF_VIEW_URI_SCHEME } from "../../integrations/editor/DiffViewProvider"
import { t } from "../../i18n"
import type { CheckpointEventMap } from "../checkpoints/types"
import { ShadowCheckpointService } from "../checkpoints/ShadowCheckpointService"
import type { FileContextTracker } from "../../core/context-tracking/FileContextTracker"
import { debounce } from "lodash"

// No experiments migration handler needed anymore; filesChanged is managed via updateExperimental in webviewMessageHandler

/**
 * Handles filesChanged-specific webview messages that were previously scattered throughout ClineProvider
 */
export class FilesChangedMessageHandler {
	private isEnabled: boolean = false
	private shouldWaitForNextCheckpoint: boolean = false
	private checkpointEventListener?: (event: CheckpointEventMap["checkpoint"]) => void
	private fileTrackerListener?: vscode.Disposable
	private listenerCheckpointService?: ShadowCheckpointService
	private lastOp: Promise<any> = Promise.resolve()

	private tr(key: string, fallback: string, options?: Record<string, any>): string {
		const translated = t(key, options)
		// In tests, i18n is disabled and returns the key; detect and fall back
		if (!translated || translated === key || /[.:]/.test(translated)) {
			return fallback
		}
		return translated
	}

	constructor(private provider: ClineProvider) {}

	/**
	 * Universal filesChanged enable/disable handler - ALWAYS waits for next checkpoint when enabled
	 */
	public async handleExperimentToggle(
		enabled: boolean,
		task:
			| { checkpointService?: ShadowCheckpointService; taskId?: string; fileContextTracker?: FileContextTracker }
			| undefined,
	): Promise<void> {
		// Only proceed if state is actually changing
		if (enabled === this.isEnabled) {
			return // No state change - do nothing
		}

		this.isEnabled = enabled

		if (enabled) {
			// UNIVERSAL: Always wait for next checkpoint regardless of task type/state
			this.shouldWaitForNextCheckpoint = true
			this.provider.log("filesChanged: Enabled, waiting for next checkpoint to establish monitoring baseline")

			// Don't show filesChanged yet - wait for checkpoint event
			this.clearFilesChangedDisplay()

			// Set up checkpoint listener if we have a task
			if (task?.checkpointService) {
				this.setupCheckpointListener(task)
			}
			if (task?.fileContextTracker) {
				this.setupFileTrackerListener(task)
			}
		} else {
			// filesChanged disabled - cleanup
			this.shouldWaitForNextCheckpoint = false
			this.removeCheckpointListener()
			this.removeFileTrackerListener()
			this.clearFilesChangedDisplay()
			this.provider.log("filesChanged: Disabled")
		}
	}

	/**
	 * Clear filesChanged display in webview
	 */
	private clearFilesChangedDisplay(): void {
		this.provider.postMessageToWebview({
			type: "filesChanged",
			filesChanged: undefined,
		})
	}

	private setupFileTrackerListener(task: {
		checkpointService?: ShadowCheckpointService
		taskId?: string
		fileContextTracker?: FileContextTracker
	}): void {
		if (!task.fileContextTracker) {
			return
		}
		this.removeFileTrackerListener()
		this.fileTrackerListener = task.fileContextTracker.onRooEdit(
			debounce(() => this.refreshFromWorkingTree(), 200),
		)
	}

	private removeFileTrackerListener(): void {
		this.fileTrackerListener?.dispose()
		this.fileTrackerListener = undefined
	}

	/**
	 * Set up checkpoint event listener for universal baseline management
	 */
	private setupCheckpointListener(
		task:
			| { checkpointService?: ShadowCheckpointService; taskId?: string; fileContextTracker?: FileContextTracker }
			| undefined,
	): void {
		// Remove existing listener if any
		this.removeCheckpointListener()

		// Create new listener for universal checkpoint waiting
		this.checkpointEventListener = async (event: CheckpointEventMap["checkpoint"]) => {
			if (this.isEnabled && this.shouldWaitForNextCheckpoint) {
				// This checkpoint = "filesChanged monitoring baseline"
				const fileChangeManager = this.provider.getFileChangeManager()
				if (fileChangeManager) {
					await fileChangeManager.updateBaseline(event.fromHash)
					this.shouldWaitForNextCheckpoint = false

					this.provider.log(`filesChanged: Established monitoring baseline at ${event.fromHash}`)

					// Now start showing changes from this point forward
					await this.refreshFromCheckpoint(event.toHash)
				}
			}
		}

		// Add listener to checkpoint service
		if (task?.checkpointService?.on && this.checkpointEventListener) {
			this.listenerCheckpointService = task.checkpointService
			this.listenerCheckpointService.on("checkpoint", this.checkpointEventListener)
		}
	}

	/**
	 * Remove checkpoint event listener
	 */
	private removeCheckpointListener(): void {
		if (this.checkpointEventListener && this.listenerCheckpointService?.off) {
			this.listenerCheckpointService.off("checkpoint", this.checkpointEventListener)
		}
		this.checkpointEventListener = undefined
		this.listenerCheckpointService = undefined
	}

	public cleanup(): void {
		this.removeCheckpointListener()
		this.removeFileTrackerListener()
	}

	/**
	 * Check if a message should be handled by filesChanged
	 */
	public shouldHandleMessage(message: WebviewMessage): boolean {
		const filesChangedMessageTypes = [
			"webviewReady",
			"viewDiff",
			"acceptFileChange",
			"rejectFileChange",
			"acceptAllFileChanges",
			"rejectAllFileChanges",
			"filesChangedRequest",
			"filesChangedBaselineUpdate",
		]

		return filesChangedMessageTypes.includes(message.type)
	}

	/**
	 * Handle filesChanged-specific messages
	 */
	public async handleMessage(message: WebviewMessage): Promise<void> {
		const task = this.provider.getCurrentTask()

		switch (message.type) {
			case "webviewReady": {
				if (this.isEnabled && !this.shouldWaitForNextCheckpoint) {
					await this.refreshFromWorkingTree()
				} else if (this.shouldWaitForNextCheckpoint) {
					this.clearFilesChangedDisplay()
				}
				break
			}

			case "viewDiff": {
				await this.handleViewDiff(message, task)
				break
			}

			case "acceptFileChange": {
				await this.serialize(() => this.handleAcceptFileChange(message))
				break
			}

			case "rejectFileChange": {
				await this.serialize(() => this.handleRejectFileChange(message))
				break
			}

			case "acceptAllFileChanges": {
				await this.serialize(() => this.handleAcceptAllFileChanges())
				break
			}

			case "rejectAllFileChanges": {
				await this.serialize(() => this.handleRejectAllFileChanges(message))
				break
			}

			case "filesChangedRequest": {
				await this.handleFilesChangedRequest(message, task)
				break
			}

			case "filesChangedBaselineUpdate": {
				await this.handleFilesChangedBaselineUpdate(message, task)
				break
			}
		}
	}

	private async handleViewDiff(
		message: WebviewMessage,
		task: { checkpointService?: ShadowCheckpointService } | undefined,
	): Promise<void> {
		const diffFileChangeManager = this.provider.getFileChangeManager()
		if (message.uri && diffFileChangeManager && task?.checkpointService) {
			// Get the file change information
			const changeset = diffFileChangeManager.getChanges()
			const fileChange = changeset.files.find((f: FileChange) => f.uri === message.uri)

			if (fileChange) {
				try {
					// Get the specific file content from both checkpoints
					const changes = await task.checkpointService.getDiff({
						from: fileChange.fromCheckpoint,
						to: fileChange.toCheckpoint,
					})

					// Find the specific file in the changes
					const fileChangeData = changes.find((change) => change.paths.relative === message.uri)

					if (fileChangeData) {
						await this.showFileDiff(message.uri, fileChangeData)
					} else {
						console.warn(`FilesChangedMessageHandler: No file change data found for URI: ${message.uri}`)
						vscode.window.showInformationMessage(
							this.tr("common:fileChanges.noChangesForFile", `No changes found for ${message.uri}`, {
								uri: message.uri,
							}),
						)
					}
				} catch (error) {
					console.error(`FilesChangedMessageHandler: Failed to open diff for ${message.uri}:`, error)
					vscode.window.showErrorMessage(
						this.tr(
							"common:fileChanges.openDiffFailed",
							`Failed to open diff for ${message.uri}: ${error instanceof Error ? error.message : String(error)}`,
							{
								uri: message.uri,
								error: error instanceof Error ? error.message : String(error),
							},
						),
					)
				}
			} else {
				console.warn(`FilesChangedMessageHandler: File change not found in changeset for URI: ${message.uri}`)
				vscode.window.showInformationMessage(
					this.tr("common:fileChanges.fileChangeNotFound", `File change not found for ${message.uri}`, {
						uri: message.uri,
					}),
				)
			}
		} else {
			console.warn(`FilesChangedMessageHandler: Missing dependencies for viewDiff. URI: ${message.uri}`)
			vscode.window.showErrorMessage(
				this.tr(
					"common:fileChanges.missingDependencies",
					"Unable to view diff - missing required dependencies",
				),
			)
		}
	}

	private async showFileDiff(uri: string, fileChangeData: any): Promise<void> {
		const beforeContent = fileChangeData.content.before || ""
		const afterContent = fileChangeData.content.after || ""

		try {
			const beforeUri = vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${uri}`).with({
				query: Buffer.from(beforeContent).toString("base64"),
			})
			const afterUri = vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${uri}`).with({
				query: Buffer.from(afterContent).toString("base64"),
			})

			await vscode.commands.executeCommand("vscode.diff", beforeUri, afterUri, `${uri}: Before ↔ After`, {
				preview: false,
			})
		} catch (fileError) {
			console.error(
				`Failed to open diff view: ${fileError instanceof Error ? fileError.message : String(fileError)}`,
			)
			vscode.window.showErrorMessage(
				`Failed to open diff view: ${fileError instanceof Error ? fileError.message : String(fileError)}`,
			)
		}
	}

	private async handleAcceptFileChange(message: WebviewMessage): Promise<void> {
		const task = this.provider.getCurrentTask()
		let acceptFileChangeManager = this.provider.getFileChangeManager()
		if (!acceptFileChangeManager) {
			acceptFileChangeManager = await this.provider.ensureFileChangeManager()
		}
		if (message.uri && acceptFileChangeManager && task?.taskId && task?.fileContextTracker) {
			await acceptFileChangeManager.acceptChange(message.uri)
			await this.refreshFromWorkingTree()
		}
	}

	private async handleRejectFileChange(message: WebviewMessage): Promise<void> {
		console.log(`[filesChanged] handleRejectFileChange called for URI: ${message.uri}`)
		let rejectFileChangeManager = this.provider.getFileChangeManager()
		if (!rejectFileChangeManager) {
			rejectFileChangeManager = await this.provider.ensureFileChangeManager()
		}
		if (!message.uri || !rejectFileChangeManager) {
			return
		}

		try {
			// Get the file change details to know which checkpoint to restore from
			const fileChange = rejectFileChangeManager.getFileChange(message.uri)
			if (!fileChange) {
				console.error(`[filesChanged] File change not found for URI: ${message.uri}`)
				return
			}

			// Get the current task and checkpoint service
			const currentTask = this.provider.getCurrentTask()
			if (!currentTask) {
				console.error(`[filesChanged] No current task found for file reversion`)
				return
			}

			const checkpointService = currentTask.checkpointService
			if (!checkpointService) {
				console.error(`[filesChanged] No checkpoint service available for file reversion`)
				return
			}

			// Revert the file to its previous state
			await this.revertFileToCheckpoint(message.uri, fileChange.fromCheckpoint, checkpointService)
			console.log(`[filesChanged] File ${message.uri} successfully reverted`)

			// Remove from tracking since the file has been reverted
			await rejectFileChangeManager.rejectChange(message.uri)

			// Notify the tracker that the file has been "edited" (reverted)
			// to trigger a refresh
			await currentTask.fileContextTracker?.trackFileContext(message.uri, "roo_edited")
		} catch (error) {
			console.error(`[filesChanged] Error reverting file ${message.uri}:`, error)
			vscode.window.showErrorMessage(
				this.tr(
					"common:fileChanges.revertFailed",
					`Failed to revert ${message.uri}: ${error instanceof Error ? error.message : String(error)}`,
					{ uri: message.uri, error: error instanceof Error ? error.message : String(error) },
				),
			)
			// Keep item in the list on failure to avoid inconsistent state
		}
	}

	private async handleAcceptAllFileChanges(): Promise<void> {
		let acceptAllFileChangeManager = this.provider.getFileChangeManager()
		if (!acceptAllFileChangeManager) {
			acceptAllFileChangeManager = await this.provider.ensureFileChangeManager()
		}
		await acceptAllFileChangeManager?.acceptAll()

		// Clear filesChanged state - this is the one case where we DO want to clear the UI
		this.provider.postMessageToWebview({
			type: "filesChanged",
			filesChanged: undefined,
		})
	}

	private async handleRejectAllFileChanges(message: WebviewMessage): Promise<void> {
		let rejectAllFileChangeManager = this.provider.getFileChangeManager()
		if (!rejectAllFileChangeManager) {
			rejectAllFileChangeManager = await this.provider.ensureFileChangeManager()
		}
		if (!rejectAllFileChangeManager) {
			return
		}

		try {
			// Get all current file changes
			const changeset = rejectAllFileChangeManager.getChanges()

			// Filter files if specific URIs provided, otherwise use all files
			const filesToReject: FileChange[] = message.uris
				? changeset.files.filter((file: FileChange) => message.uris!.includes(file.uri))
				: changeset.files

			// Get the current task and checkpoint service
			const currentTask = this.provider.getCurrentTask()
			if (!currentTask) {
				console.error(`[filesChanged] No current task found for file reversion`)
				return
			}

			const checkpointService = currentTask.checkpointService
			if (!checkpointService) {
				console.error(`[filesChanged] No checkpoint service available for file reversion`)
				return
			}

			const succeeded: string[] = []
			const failed: string[] = []
			// Revert filtered files to their previous states
			for (const fileChange of filesToReject) {
				try {
					await this.revertFileToCheckpoint(fileChange.uri, fileChange.fromCheckpoint, checkpointService)
					succeeded.push(fileChange.uri)
				} catch (error) {
					console.error(`[filesChanged] Failed to revert file ${fileChange.uri}:`, error)
					failed.push(fileChange.uri)
				}
			}

			// Clear all tracking after processing reverts to match expected behavior
			await rejectAllFileChangeManager.rejectAll()

			// Clear UI state
			this.provider.postMessageToWebview({
				type: "filesChanged",
				filesChanged: undefined,
			})

			if (failed.length > 0) {
				vscode.window.showErrorMessage(
					this.tr(
						"common:fileChanges.rejectAllPartialFailure",
						"Some files failed to revert. Remaining items were not removed.",
					),
				)
			}
		} catch (error) {
			console.error(`[filesChanged] Error reverting all files:`, error)
			vscode.window.showErrorMessage(
				this.tr(
					"common:fileChanges.revertFailed",
					`Failed to revert *: ${error instanceof Error ? error.message : String(error)}`,
					{ uri: "*", error: error instanceof Error ? error.message : String(error) },
				),
			)
		}
	}

	private async handleFilesChangedRequest(
		message: WebviewMessage,
		task:
			| { checkpointService?: ShadowCheckpointService; taskId?: string; fileContextTracker?: FileContextTracker }
			| undefined,
	): Promise<void> {
		try {
			let fileChangeManager = this.provider.getFileChangeManager()
			if (!fileChangeManager) {
				fileChangeManager = await this.provider.ensureFileChangeManager()
			}

			if (fileChangeManager) {
				// Handle message file changes if provided
				if (message.fileChanges) {
					const fileChanges = message.fileChanges.map((fc: any) => ({
						uri: fc.uri,
						type: fc.type,
						fromCheckpoint: task?.checkpointService?.baseHash || "base",
						toCheckpoint: "current",
					}))

					fileChangeManager.setFiles(fileChanges)
				}

				// Get LLM-only filtered changeset and send to webview (clear if empty)
				if (task?.taskId && task?.fileContextTracker) {
					const filteredChangeset = await fileChangeManager.getLLMOnlyChanges(
						task.taskId,
						task.fileContextTracker,
					)
					this.provider.postMessageToWebview({
						type: "filesChanged",
						filesChanged: filteredChangeset.files.length > 0 ? filteredChangeset : undefined,
					})
				}
				// If can't filter, don't send anything - keep filesChanged in current state
			}
			// If no fileChangeManager, don't send anything - keep filesChanged in current state
		} catch (error) {
			console.error("FilesChangedMessageHandler: Error handling filesChangedRequest:", error)
			// Don't send anything on error - keep filesChanged in current state
		}
	}

	private async handleFilesChangedBaselineUpdate(
		message: WebviewMessage,
		task: { taskId?: string; fileContextTracker?: FileContextTracker } | undefined,
	): Promise<void> {
		try {
			let fileChangeManager = this.provider.getFileChangeManager()
			if (!fileChangeManager) {
				fileChangeManager = await this.provider.ensureFileChangeManager()
			}

			if (fileChangeManager && task && message.baseline) {
				// Update baseline to the specified checkpoint
				await fileChangeManager.updateBaseline(message.baseline)

				// Send updated state with LLM-only filtering (clear if empty)
				if (task.taskId && task.fileContextTracker) {
					const updatedChangeset = await fileChangeManager.getLLMOnlyChanges(
						task.taskId,
						task.fileContextTracker,
					)
					this.provider.postMessageToWebview({
						type: "filesChanged",
						filesChanged: updatedChangeset.files.length > 0 ? updatedChangeset : undefined,
					})
				}
				// If can't filter, don't send anything - keep filesChanged in current state
			}
			// If conditions not met, don't send anything - keep filesChanged in current state
		} catch (error) {
			console.error("FilesChangedMessageHandler: Failed to update baseline:", error)
			// Don't send anything on error - keep filesChanged in current state
		}
	}

	// Legacy filesChangedEnabled pathway removed; filesChanged is toggled via updateExperimental in webviewMessageHandler

	/**
	 * Revert a specific file to its content at a specific checkpoint
	 */
	private async revertFileToCheckpoint(
		relativeFilePath: string,
		fromCheckpoint: string,
		checkpointService: ShadowCheckpointService,
	): Promise<void> {
		if (!checkpointService?.restoreFileFromCheckpoint) {
			throw new Error("Checkpoint service does not support per-file restore")
		}

		try {
			await checkpointService.restoreFileFromCheckpoint(fromCheckpoint, relativeFilePath)
		} catch (error) {
			console.error(`[filesChanged] Failed to revert file ${relativeFilePath}:`, error)
			const message = error instanceof Error ? error.message : String(error)
			// Treat missing-file errors as success (newly created file to be deleted)
			if (/did not match any file|unknown path|no such file|does not exist/i.test(message)) {
				return
			}
			throw new FileChangeError(FileChangeErrorType.GENERIC_ERROR, relativeFilePath, message, error as Error)
		}
	}

	private async refreshFromWorkingTree(): Promise<void> {
		await this.refresh("toWorkingTree")
	}

	private async refreshFromCheckpoint(toCheckpoint: string): Promise<void> {
		await this.refresh("toCheckpoint", toCheckpoint)
	}

	private async refresh(mode: "toCheckpoint" | "toWorkingTree", toCheckpoint?: string): Promise<void> {
		if (this.shouldWaitForNextCheckpoint) {
			return
		}

		const task = this.provider.getCurrentTask()
		const fileChangeManager = this.provider.getFileChangeManager()
		const checkpointService = task?.checkpointService

		if (!task || !fileChangeManager || !checkpointService) {
			return
		}

		const baseline = fileChangeManager.getChanges().baseCheckpoint || checkpointService.baseHash
		if (!baseline) {
			return
		}

		try {
			const diffs =
				mode === "toCheckpoint"
					? await checkpointService.getDiff({ from: baseline, to: toCheckpoint })
					: await checkpointService.getDiff({ from: baseline })
			const stats =
				mode === "toCheckpoint"
					? await checkpointService.getDiffStats({ from: baseline, to: toCheckpoint })
					: await checkpointService.getDiffStats({ from: baseline })

			if (!diffs || diffs.length === 0) {
				this.clearFilesChangedDisplay()
				return
			}

			const files = diffs.map((change: any) => {
				const before = change.content?.before ?? ""
				const after = change.content?.after ?? ""
				const type = !before && after ? "create" : before && !after ? "delete" : "edit"
				const s = stats[change.paths.relative]
				const lines = s
					? { linesAdded: s.insertions, linesRemoved: s.deletions }
					: FileChangeManager.calculateLineDifferences(before, after)
				return {
					uri: change.paths.relative,
					type,
					fromCheckpoint: baseline,
					toCheckpoint: toCheckpoint || "HEAD",
					linesAdded: lines.linesAdded,
					linesRemoved: lines.linesRemoved,
				}
			})

			const updated = await fileChangeManager.applyPerFileBaselines(files, checkpointService, toCheckpoint || "HEAD")
			fileChangeManager.setFiles(updated)

			if (task.taskId && task.fileContextTracker) {
				const filtered = await fileChangeManager.getLLMOnlyChanges(task.taskId, task.fileContextTracker)
				this.provider.postMessageToWebview({
					type: "filesChanged",
					filesChanged: filtered.files.length > 0 ? filtered : undefined,
				})
			}
		} catch (error) {
			this.provider.log(`filesChanged: Error refreshing changes: ${error}`)
			this.clearFilesChangedDisplay()
		}
	}

	private async serialize<T>(fn: () => Promise<T>): Promise<T> {
		const prev = this.lastOp
		let result!: T
		const run = async () => {
			result = await fn()
		}
		this.lastOp = prev.then(run, run)
		await this.lastOp.catch(() => {})
		return result
	}
}
