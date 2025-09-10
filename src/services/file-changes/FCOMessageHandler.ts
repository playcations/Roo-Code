import * as vscode from "vscode"
import { WebviewMessage } from "../../shared/WebviewMessage"
import type { FileChangeType } from "@roo-code/types"
import { FileChangeManager } from "./FileChangeManager"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { DIFF_VIEW_URI_SCHEME } from "../../integrations/editor/DiffViewProvider"
// No experiments migration handler needed anymore; FCO is managed via updateExperimental in webviewMessageHandler

/**
 * Handles FCO-specific webview messages that were previously scattered throughout ClineProvider
 */
export class FCOMessageHandler {
	private isEnabled: boolean = false
	private shouldWaitForNextCheckpoint: boolean = false
	private checkpointEventListener?: (event: any) => void

	constructor(private provider: ClineProvider) {}

	/**
	 * Universal FCO enable/disable handler - ALWAYS waits for next checkpoint when enabled
	 */
	public async handleExperimentToggle(enabled: boolean, task: any): Promise<void> {
		// Only proceed if state is actually changing
		if (enabled === this.isEnabled) {
			return // No state change - do nothing
		}

		this.isEnabled = enabled

		if (enabled) {
			// UNIVERSAL: Always wait for next checkpoint regardless of task type/state
			this.shouldWaitForNextCheckpoint = true
			this.provider.log("FCO: Enabled, waiting for next checkpoint to establish monitoring baseline")

			// Don't show FCO yet - wait for checkpoint event
			this.clearFCODisplay()

			// Set up checkpoint listener if we have a task
			if (task?.checkpointService) {
				this.setupCheckpointListener(task)
			}
		} else {
			// FCO disabled - cleanup
			this.shouldWaitForNextCheckpoint = false
			this.removeCheckpointListener(task)
			this.clearFCODisplay()
			this.provider.log("FCO: Disabled")
		}
	}

	/**
	 * Clear FCO display in webview
	 */
	private clearFCODisplay(): void {
		this.provider.postMessageToWebview({
			type: "filesChanged",
			filesChanged: undefined,
		})
	}

	/**
	 * Set up checkpoint event listener for universal baseline management
	 */
	private setupCheckpointListener(task: any): void {
		// Remove existing listener if any
		this.removeCheckpointListener(task)

		// Create new listener for universal checkpoint waiting
		this.checkpointEventListener = async (event: any) => {
			if (this.isEnabled && this.shouldWaitForNextCheckpoint) {
				// This checkpoint = "FCO monitoring baseline"
				const fileChangeManager = this.provider.getFileChangeManager()
				if (fileChangeManager) {
					await fileChangeManager.updateBaseline(event.fromHash)
					this.shouldWaitForNextCheckpoint = false

					this.provider.log(`FCO: Established monitoring baseline at ${event.fromHash}`)

					// Now start showing changes from this point forward
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
				}
			}
		}

		// Add listener to checkpoint service
		if (task.checkpointService?.on) {
			task.checkpointService.on("checkpoint", this.checkpointEventListener)
		}
	}

	/**
	 * Remove checkpoint event listener
	 */
	private removeCheckpointListener(task: any): void {
		if (this.checkpointEventListener && task?.checkpointService?.off) {
			task.checkpointService.off("checkpoint", this.checkpointEventListener)
		}
		this.checkpointEventListener = undefined
	}

	/**
	 * Check if a message should be handled by FCO
	 */
	public shouldHandleMessage(message: WebviewMessage): boolean {
		const fcoMessageTypes = [
			"webviewReady",
			"viewDiff",
			"acceptFileChange",
			"rejectFileChange",
			"acceptAllFileChanges",
			"rejectAllFileChanges",
			"filesChangedRequest",
			"filesChangedBaselineUpdate",
		]

		return fcoMessageTypes.includes(message.type)
	}

	/**
	 * Handle FCO-specific messages
	 */
	public async handleMessage(message: WebviewMessage): Promise<void> {
		const task = this.provider.getCurrentTask()

		switch (message.type) {
			case "webviewReady": {
				// Only show FCO if we're not waiting for a checkpoint
				if (this.isEnabled && !this.shouldWaitForNextCheckpoint) {
					// Ensure FileChangeManager is initialized when webview is ready
					let fileChangeManager = this.provider.getFileChangeManager()
					if (!fileChangeManager) {
						fileChangeManager = await this.provider.ensureFileChangeManager()
					}
					if (fileChangeManager && task?.taskId && task?.fileContextTracker) {
						const filteredChangeset = await fileChangeManager.getLLMOnlyChanges(
							task.taskId,
							task.fileContextTracker,
						)
						// Send current view; if empty, explicitly clear stale UI
						this.provider.postMessageToWebview({
							type: "filesChanged",
							filesChanged: filteredChangeset.files.length > 0 ? filteredChangeset : undefined,
						})
					}
				} else if (this.shouldWaitForNextCheckpoint) {
					// FCO is waiting for next checkpoint - clear display
					this.clearFCODisplay()
				}
				// If FCO disabled or can't filter, don't send anything - keep FCO in current state
				break
			}

			case "viewDiff": {
				await this.handleViewDiff(message, task)
				break
			}

			case "acceptFileChange": {
				await this.handleAcceptFileChange(message)
				break
			}

			case "rejectFileChange": {
				await this.handleRejectFileChange(message)
				break
			}

			case "acceptAllFileChanges": {
				await this.handleAcceptAllFileChanges()
				break
			}

			case "rejectAllFileChanges": {
				await this.handleRejectAllFileChanges(message)
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

	private async handleViewDiff(message: WebviewMessage, task: any): Promise<void> {
		const diffFileChangeManager = this.provider.getFileChangeManager()
		if (message.uri && diffFileChangeManager && task?.checkpointService) {
			// Get the file change information
			const changeset = diffFileChangeManager.getChanges()
			const fileChange = changeset.files.find((f: any) => f.uri === message.uri)

			if (fileChange) {
				try {
					// Get the specific file content from both checkpoints
					const changes = await task.checkpointService.getDiff({
						from: fileChange.fromCheckpoint,
						to: fileChange.toCheckpoint,
					})

					// Find the specific file in the changes
					const fileChangeData = changes.find((change: any) => change.paths.relative === message.uri)

					if (fileChangeData) {
						await this.showFileDiff(message.uri, fileChangeData)
					} else {
						console.warn(`FCOMessageHandler: No file change data found for URI: ${message.uri}`)
						vscode.window.showInformationMessage(`No changes found for ${message.uri}`)
					}
				} catch (error) {
					console.error(`FCOMessageHandler: Failed to open diff for ${message.uri}:`, error)
					vscode.window.showErrorMessage(`Failed to open diff for ${message.uri}: ${error.message}`)
				}
			} else {
				console.warn(`FCOMessageHandler: File change not found in changeset for URI: ${message.uri}`)
				vscode.window.showInformationMessage(`File change not found for ${message.uri}`)
			}
		} else {
			console.warn(`FCOMessageHandler: Missing dependencies for viewDiff. URI: ${message.uri}`)
			vscode.window.showErrorMessage("Unable to view diff - missing required dependencies")
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

			// Send updated state (clear if now empty)
			const updatedChangeset = await acceptFileChangeManager.getLLMOnlyChanges(
				task.taskId,
				task.fileContextTracker,
			)
			this.provider.postMessageToWebview({
				type: "filesChanged",
				filesChanged: updatedChangeset.files.length > 0 ? updatedChangeset : undefined,
			})
		}
	}

	private async handleRejectFileChange(message: WebviewMessage): Promise<void> {
		console.log(`[FCO] handleRejectFileChange called for URI: ${message.uri}`)
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
				console.error(`[FCO] File change not found for URI: ${message.uri}`)
				return
			}

			// Get the current task and checkpoint service
			const currentTask = this.provider.getCurrentTask()
			if (!currentTask) {
				console.error(`[FCO] No current task found for file reversion`)
				return
			}

			const checkpointService = currentTask.checkpointService
			if (!checkpointService) {
				console.error(`[FCO] No checkpoint service available for file reversion`)
				return
			}

			// Revert the file to its previous state
			await this.revertFileToCheckpoint(message.uri, fileChange.fromCheckpoint, checkpointService)
			console.log(`[FCO] File ${message.uri} successfully reverted`)

			// Remove from tracking since the file has been reverted
			await rejectFileChangeManager.rejectChange(message.uri)

			// Send updated state with LLM-only filtering only if there are remaining changes
			if (currentTask?.taskId && currentTask?.fileContextTracker) {
				const updatedChangeset = await rejectFileChangeManager.getLLMOnlyChanges(
					currentTask.taskId,
					currentTask.fileContextTracker,
				)
				console.log(`[FCO] After rejection, found ${updatedChangeset.files.length} remaining LLM-only files`)
				this.provider.postMessageToWebview({
					type: "filesChanged",
					filesChanged: updatedChangeset.files.length > 0 ? updatedChangeset : undefined,
				})
			}
		} catch (error) {
			console.error(`[FCO] Error reverting file ${message.uri}:`, error)
			// Fall back to old behavior (just remove from display) if reversion fails
			await rejectFileChangeManager.rejectChange(message.uri)

			// Don't send fallback message - just log the error and keep FCO in current state
		}
	}

	private async handleAcceptAllFileChanges(): Promise<void> {
		let acceptAllFileChangeManager = this.provider.getFileChangeManager()
		if (!acceptAllFileChangeManager) {
			acceptAllFileChangeManager = await this.provider.ensureFileChangeManager()
		}
		await acceptAllFileChangeManager?.acceptAll()

		// Clear FCO state - this is the one case where we DO want to clear the UI
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
			const filesToReject = message.uris
				? changeset.files.filter((file: any) => message.uris!.includes(file.uri))
				: changeset.files

			// Get the current task and checkpoint service
			const currentTask = this.provider.getCurrentTask()
			if (!currentTask) {
				console.error(`[FCO] No current task found for file reversion`)
				return
			}

			const checkpointService = currentTask.checkpointService
			if (!checkpointService) {
				console.error(`[FCO] No checkpoint service available for file reversion`)
				return
			}

			// Revert filtered files to their previous states
			for (const fileChange of filesToReject) {
				try {
					await this.revertFileToCheckpoint(fileChange.uri, fileChange.fromCheckpoint, checkpointService)
				} catch (error) {
					console.error(`[FCO] Failed to revert file ${fileChange.uri}:`, error)
					// Continue with other files even if one fails
				}
			}

			// Clear all tracking after reverting files
			await rejectAllFileChangeManager.rejectAll()

			// Clear state
			this.provider.postMessageToWebview({
				type: "filesChanged",
				filesChanged: undefined,
			})
		} catch (error) {
			console.error(`[FCO] Error reverting all files:`, error)
			// Fall back to old behavior if reversion fails
			await rejectAllFileChangeManager.rejectAll()
			this.provider.postMessageToWebview({
				type: "filesChanged",
				filesChanged: undefined,
			})
		}
	}

	private async handleFilesChangedRequest(message: WebviewMessage, task: any): Promise<void> {
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
				// If can't filter, don't send anything - keep FCO in current state
			}
			// If no fileChangeManager, don't send anything - keep FCO in current state
		} catch (error) {
			console.error("FCOMessageHandler: Error handling filesChangedRequest:", error)
			// Don't send anything on error - keep FCO in current state
		}
	}

	private async handleFilesChangedBaselineUpdate(message: WebviewMessage, task: any): Promise<void> {
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
				// If can't filter, don't send anything - keep FCO in current state
			}
			// If conditions not met, don't send anything - keep FCO in current state
		} catch (error) {
			console.error("FCOMessageHandler: Failed to update baseline:", error)
			// Don't send anything on error - keep FCO in current state
		}
	}

	// Legacy filesChangedEnabled pathway removed; FCO is toggled via updateExperimental in webviewMessageHandler

	/**
	 * Revert a specific file to its content at a specific checkpoint
	 */
	private async revertFileToCheckpoint(
		relativeFilePath: string,
		fromCheckpoint: string,
		checkpointService: any,
	): Promise<void> {
		if (!checkpointService?.restoreFileFromCheckpoint) {
			throw new Error("Checkpoint service does not support per-file restore")
		}

		try {
			await checkpointService.restoreFileFromCheckpoint(fromCheckpoint, relativeFilePath)
		} catch (error) {
			console.error(`[FCO] Failed to revert file ${relativeFilePath}:`, error)
			throw error
		}
	}
}
