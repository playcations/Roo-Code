import * as vscode from "vscode"
import { WebviewMessage } from "../../shared/WebviewMessage"
import type { FileChangeType } from "@roo-code/types"
import { FileChangeManager } from "./FileChangeManager"
import { ClineProvider } from "../../core/webview/ClineProvider"

/**
 * Handles FCO-specific webview messages that were previously scattered throughout ClineProvider
 */
export class FCOMessageHandler {
	constructor(private provider: ClineProvider) {}

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
		const task = this.provider.getCurrentCline()

		switch (message.type) {
			case "webviewReady": {
				const fileChangeManager = this.provider.getFileChangeManager()
				if (fileChangeManager) {
					this.provider.postMessageToWebview({
						type: "filesChanged",
						filesChanged: fileChangeManager.getChanges(),
					})
				}
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
				await this.handleRejectAllFileChanges()
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
			const fileChange = changeset.files.find((f) => f.uri === message.uri)

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

		// Create temporary files for the diff view
		const tempDir = require("os").tmpdir()
		const path = require("path")
		const fs = require("fs/promises")

		const fileName = path.basename(uri)
		const beforeTempPath = path.join(tempDir, `${fileName}.before.tmp`)
		const afterTempPath = path.join(tempDir, `${fileName}.after.tmp`)

		try {
			// Write temporary files
			await fs.writeFile(beforeTempPath, beforeContent, "utf8")
			await fs.writeFile(afterTempPath, afterContent, "utf8")

			// Create URIs for the temporary files
			const beforeUri = vscode.Uri.file(beforeTempPath)
			const afterUri = vscode.Uri.file(afterTempPath)

			// Open the diff view for this specific file
			await vscode.commands.executeCommand("vscode.diff", beforeUri, afterUri, `${uri}: Before ↔ After`, {
				preview: false,
			})

			// Clean up temporary files after a delay
			setTimeout(async () => {
				try {
					await fs.unlink(beforeTempPath)
					await fs.unlink(afterTempPath)
				} catch (cleanupError) {
					console.warn(`Failed to clean up temp files: ${cleanupError.message}`)
				}
			}, 30000) // Clean up after 30 seconds
		} catch (fileError) {
			console.error(`Failed to create temporary files: ${fileError.message}`)
			vscode.window.showErrorMessage(`Failed to create diff view: ${fileError.message}`)
		}
	}

	private async handleAcceptFileChange(message: WebviewMessage): Promise<void> {
		const acceptFileChangeManager = this.provider.getFileChangeManager()
		if (message.uri && acceptFileChangeManager) {
			await acceptFileChangeManager.acceptChange(message.uri)

			// Send updated state
			const updatedChangeset = acceptFileChangeManager.getChanges()
			this.provider.postMessageToWebview({
				type: "filesChanged",
				filesChanged: updatedChangeset.files.length > 0 ? updatedChangeset : undefined,
			})
		}
	}

	private async handleRejectFileChange(message: WebviewMessage): Promise<void> {
		const rejectFileChangeManager = this.provider.getFileChangeManager()
		if (message.uri && rejectFileChangeManager) {
			// Remove from tracking
			await rejectFileChangeManager.rejectChange(message.uri)

			// Send updated state
			const updatedChangeset = rejectFileChangeManager.getChanges()
			this.provider.postMessageToWebview({
				type: "filesChanged",
				filesChanged: updatedChangeset.files.length > 0 ? updatedChangeset : undefined,
			})
		}
	}

	private async handleAcceptAllFileChanges(): Promise<void> {
		const acceptAllFileChangeManager = this.provider.getFileChangeManager()
		await acceptAllFileChangeManager?.acceptAll()

		// Clear state
		this.provider.postMessageToWebview({
			type: "filesChanged",
			filesChanged: undefined,
		})
	}

	private async handleRejectAllFileChanges(): Promise<void> {
		const rejectAllFileChangeManager = this.provider.getFileChangeManager()
		if (rejectAllFileChangeManager) {
			// Clear all tracking
			await rejectAllFileChangeManager.rejectAll()

			// Clear state
			this.provider.postMessageToWebview({
				type: "filesChanged",
				filesChanged: undefined,
			})
		}
	}

	private async handleFilesChangedRequest(message: WebviewMessage, task: any): Promise<void> {
		try {
			const fileChangeManager = this.provider.getFileChangeManager()

			if (fileChangeManager && task?.checkpointService) {
				const changeset = fileChangeManager.getChanges()

				// Handle message file changes if provided
				if (message.fileChanges) {
					const fileChanges = message.fileChanges.map((fc: any) => ({
						uri: fc.uri,
						type: fc.type,
						fromCheckpoint: task.checkpointService?.baseHash || "base",
						toCheckpoint: "current",
					}))

					fileChangeManager.setFiles(fileChanges)
				}

				// Get filtered changeset and send to webview
				const filteredChangeset = fileChangeManager.getChanges()
				this.provider.postMessageToWebview({
					type: "filesChanged",
					filesChanged: filteredChangeset.files.length > 0 ? filteredChangeset : undefined,
				})
			} else {
				this.provider.postMessageToWebview({
					type: "filesChanged",
					filesChanged: undefined,
				})
			}
		} catch (error) {
			console.error("FCOMessageHandler: Error handling filesChangedRequest:", error)
			// Send empty response to prevent FCO from hanging
			this.provider.postMessageToWebview({
				type: "filesChanged",
				filesChanged: undefined,
			})
		}
	}

	private async handleFilesChangedBaselineUpdate(message: WebviewMessage, task: any): Promise<void> {
		try {
			const fileChangeManager = this.provider.getFileChangeManager()

			if (fileChangeManager && task && message.baseline) {
				// Update baseline to the specified checkpoint
				await fileChangeManager.updateBaseline(message.baseline)

				// Send updated state
				const updatedChangeset = fileChangeManager.getChanges()
				this.provider.postMessageToWebview({
					type: "filesChanged",
					filesChanged: updatedChangeset.files.length > 0 ? updatedChangeset : undefined,
				})
			} else {
				this.provider.postMessageToWebview({
					type: "filesChanged",
					filesChanged: undefined,
				})
			}
		} catch (error) {
			console.error("FCOMessageHandler: Failed to update baseline:", error)
			this.provider.postMessageToWebview({
				type: "filesChanged",
				filesChanged: undefined,
			})
		}
	}
}
