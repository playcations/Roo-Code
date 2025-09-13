// Tests for FilesChangedMessageHandler - Files Changed Overview message handling
// npx vitest run src/services/file-changes/__tests__/FilesChangedMessageHandler.test.ts

import { describe, beforeEach, afterEach, it, expect, vi, Mock } from "vitest"
import * as vscode from "vscode"
import * as fs from "fs/promises"
import { FilesChangedMessageHandler } from "../FilesChangedMessageHandler"
import { FileChangeManager } from "../FileChangeManager"
import { WebviewMessage } from "../../../shared/WebviewMessage"
import type { FileChange } from "@roo-code/types"
import type { TaskMetadata } from "../../../core/context-tracking/FileContextTrackerTypes"
import type { FileContextTracker } from "../../../core/context-tracking/FileContextTracker"
// No checkpoint migration utilities needed; legacy filesChangedEnabled removed

vi.mock("lodash", () => ({
	debounce: vi.fn((fn) => fn),
}))

// Mock VS Code
vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
	},
	commands: {
		executeCommand: vi.fn(),
	},
	workspace: {
		workspaceFolders: [
			{
				uri: {
					fsPath: "/test/workspace",
				},
			},
		],
	},
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path })),
		parse: vi.fn((spec: string) => ({
			with: vi.fn(() => ({})),
			toString: vi.fn(() => spec),
		})),
	},
	EventEmitter: class EventEmitter {
		_listeners: any[] = []
		event = (listener: any) => {
			this._listeners.push(listener)
			return { dispose: () => {} }
		}
		fire = (...args: any[]) => {
			this._listeners.forEach((listener) => listener(...args))
		}
		dispose = () => {
			this._listeners = []
		}
	},
}))

// Mock fs promises
vi.mock("fs/promises", () => ({
	writeFile: vi.fn(),
	unlink: vi.fn(),
}))

// Mock os
vi.mock("os", () => ({
	tmpdir: vi.fn(() => "/tmp"),
}))

// Mock path
vi.mock("path", () => ({
	join: vi.fn((...args: string[]) => args.join("/")),
	basename: vi.fn((path: string) => path.split("/").pop() || ""),
}))

// No-op: legacy checkpoints mocks removed

describe("FilesChangedMessageHandler", () => {
	let handler: FilesChangedMessageHandler
	let mockProvider: any
	let mockTask: any
	let mockFileChangeManager: any
	let mockCheckpointService: any
	let mockFileContextTracker: any
	let onRooEditEmitter: vscode.EventEmitter<void>

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		onRooEditEmitter = new (vscode.EventEmitter as any)()

		// Mock FileContextTracker
		mockFileContextTracker = {
			getTaskMetadata: vi.fn().mockResolvedValue({
				files_in_context: [
					{ path: "file1.txt", record_source: "roo_edited" },
					{ path: "file2.txt", record_source: "user_edited" },
					{ path: "file3.txt", record_source: "roo_edited" },
				],
			} as TaskMetadata),
			onRooEdit: onRooEditEmitter.event,
			trackFileContext: vi.fn(),
		} as unknown as FileContextTracker

		// Mock CheckpointService
		mockCheckpointService = {
			baseHash: "base123",
			getDiff: vi.fn(),
			getDiffStats: vi.fn().mockResolvedValue({}),
			getContent: vi.fn(),
			restoreFileFromCheckpoint: vi.fn(),
			getCurrentCheckpoint: vi.fn().mockReturnValue("checkpoint-123"),
			on: vi.fn(),
			off: vi.fn(),
		}

		// Mock FileChangeManager
		mockFileChangeManager = {
			getChanges: vi.fn().mockReturnValue({ baseCheckpoint: "base123", files: [] }),
			getLLMOnlyChanges: vi.fn().mockResolvedValue({ baseCheckpoint: "base123", files: [] }),
			getFileChange: vi.fn(),
			acceptChange: vi.fn(),
			rejectChange: vi.fn(),
			acceptAll: vi.fn(),
			rejectAll: vi.fn(),
			setFiles: vi.fn(),
			updateBaseline: vi.fn(),
			applyPerFileBaselines: vi.fn((files) => Promise.resolve(files)),
		}

		// Mock Task
		mockTask = {
			taskId: "test-task-id",
			fileContextTracker: mockFileContextTracker,
			checkpointService: mockCheckpointService,
		}

		// Mock ClineProvider
		mockProvider = {
			getCurrentTask: vi.fn().mockReturnValue(mockTask),
			getFileChangeManager: vi.fn().mockReturnValue(mockFileChangeManager),
			ensureFileChangeManager: vi.fn().mockResolvedValue(mockFileChangeManager),
			postMessageToWebview: vi.fn(),
			getGlobalState: vi.fn(),
			contextProxy: {
				setValue: vi.fn(),
				getGlobalState: vi.fn(),
			},
			postStateToWebview: vi.fn(),
			log: vi.fn(),
		}

		handler = new FilesChangedMessageHandler(mockProvider)
	})

	describe("Tracker-Driven Refresh", () => {
		beforeEach(async () => {
			await handler.handleExperimentToggle(true, mockTask)
			// @ts-ignore
			handler.shouldWaitForNextCheckpoint = false // Assume baseline is set
		})

		it("should refresh from working tree on onRooEdit event", async () => {
			mockCheckpointService.getDiff.mockResolvedValue([{ paths: { relative: "file1.txt" }, content: {} }])
			mockFileChangeManager.getLLMOnlyChanges.mockResolvedValue({
				files: [{ uri: "file1.txt" }],
			})

			onRooEditEmitter.fire()

			await new Promise(process.nextTick) // Wait for debounce

			expect(mockCheckpointService.getDiff).toHaveBeenCalledWith({ from: "base123" })
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "filesChanged",
				}),
			)
		})

		it("should not refresh if waiting for checkpoint", async () => {
			// @ts-ignore
			handler.shouldWaitForNextCheckpoint = true

			onRooEditEmitter.fire()
			await new Promise(process.nextTick)

			expect(mockCheckpointService.getDiff).not.toHaveBeenCalled()
		})

		it("should trigger refresh on webviewReady", async () => {
			await handler.handleMessage({ type: "webviewReady" } as WebviewMessage)
			expect(mockCheckpointService.getDiff).toHaveBeenCalledWith({ from: "base123" })
		})

		it("should trigger refresh after rejecting a file", async () => {
			const uri = "file1.txt"
			mockFileChangeManager.getFileChange.mockReturnValue({ fromCheckpoint: "cp1" })
			await handler.handleMessage({ type: "rejectFileChange", uri } as WebviewMessage)
			expect(mockFileContextTracker.trackFileContext).toHaveBeenCalledWith(uri, "roo_edited")
		})
	})

	describe("acceptAll / rejectAll", () => {
		beforeEach(() => {
			mockFileChangeManager.getChanges.mockReturnValue({
				files: [
					{
						uri: "a.txt",
						type: "edit",
						fromCheckpoint: "b1",
						toCheckpoint: "c1",
						linesAdded: 1,
						linesRemoved: 0,
					},
					{
						uri: "b.txt",
						type: "create",
						fromCheckpoint: "b1",
						toCheckpoint: "c1",
						linesAdded: 2,
						linesRemoved: 0,
					},
				],
			})
		})

		it("acceptAll clears manager and UI", async () => {
			await handler.handleMessage({ type: "acceptAllFileChanges" } as WebviewMessage)
			expect(mockFileChangeManager.acceptAll).toHaveBeenCalled()
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "filesChanged",
				filesChanged: undefined,
			})
		})

		it("rejectAll with URIs reverts only specified files and clears UI", async () => {
			await handler.handleMessage({ type: "rejectAllFileChanges", uris: ["a.txt"] } as WebviewMessage)
			expect(mockCheckpointService.restoreFileFromCheckpoint).toHaveBeenCalledWith("b1", "a.txt")
			expect(mockFileChangeManager.rejectAll).toHaveBeenCalled()
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "filesChanged",
				filesChanged: undefined,
			})
		})

		it("rejectAll without URIs reverts all files and clears UI", async () => {
			await handler.handleMessage({ type: "rejectAllFileChanges" } as WebviewMessage)
			expect(mockCheckpointService.restoreFileFromCheckpoint).toHaveBeenCalledWith("b1", "a.txt")
			expect(mockCheckpointService.restoreFileFromCheckpoint).toHaveBeenCalledWith("b1", "b.txt")
			expect(mockFileChangeManager.rejectAll).toHaveBeenCalled()
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "filesChanged",
				filesChanged: undefined,
			})
		})

		it("rejectAll continues on partial restore failures and clears UI", async () => {
			// Fail first file, succeed second
			let call = 0
			mockCheckpointService.restoreFileFromCheckpoint.mockImplementation(() => {
				call++
				if (call === 1) throw new Error("revert failed")
				return Promise.resolve()
			})

			await handler.handleMessage({ type: "rejectAllFileChanges" } as WebviewMessage)

			// Both attempted
			expect(mockCheckpointService.restoreFileFromCheckpoint).toHaveBeenCalledWith("b1", "a.txt")
			expect(mockCheckpointService.restoreFileFromCheckpoint).toHaveBeenCalledWith("b1", "b.txt")
			// Manager cleared and UI cleared despite failure
			expect(mockFileChangeManager.rejectAll).toHaveBeenCalled()
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "filesChanged",
				filesChanged: undefined,
			})
		})
	})
	afterEach(() => {
		// Restore and clear all spies/mocks to avoid bleed between tests
		vi.restoreAllMocks()
		vi.clearAllMocks()
	})

	describe("handleExperimentToggle", () => {
		it("enables and waits for checkpoint; updates baseline then posts filtered files", async () => {
			const saved: Record<string, (...args: any[]) => unknown> = {}
			mockCheckpointService.on.mockImplementation((evt: string, cb: (...args: any[]) => unknown) => {
				saved[evt] = cb
			})

			const filteredChangeset = {
				baseCheckpoint: "base-xyz",
				files: [
					{
						uri: "a.txt",
						type: "edit",
						fromCheckpoint: "base-xyz",
						toCheckpoint: "cur",
						linesAdded: 1,
						linesRemoved: 0,
					},
				],
			}
			mockFileChangeManager.getLLMOnlyChanges.mockResolvedValue(filteredChangeset)

			await handler.handleExperimentToggle(true, mockTask)
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "filesChanged",
				filesChanged: undefined,
			})
			expect(mockCheckpointService.on).toHaveBeenCalledWith("checkpoint", expect.any(Function))

			// Simulate checkpoint event
			await saved["checkpoint"]?.({ fromHash: "base-xyz", toHash: "cur" })
			expect(mockFileChangeManager.updateBaseline).toHaveBeenCalledWith("base-xyz")
		})

		it("disables: unsubscribes and clears display", async () => {
			await handler.handleExperimentToggle(true, mockTask)
			await handler.handleExperimentToggle(false, mockTask)
			expect(mockCheckpointService.off).toHaveBeenCalledWith("checkpoint", expect.any(Function))
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "filesChanged",
				filesChanged: undefined,
			})
		})
	})

	describe("shouldHandleMessage", () => {
		it("should handle all filesChanged message types", () => {
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

			filesChangedMessageTypes.forEach((type) => {
				expect(handler.shouldHandleMessage({ type } as WebviewMessage)).toBe(true)
			})
		})

		it("should not handle non-filesChanged message types", () => {
			const nonFilesChangedTypes = ["apiRequest", "taskComplete", "userMessage", "unknown"]

			nonFilesChangedTypes.forEach((type) => {
				expect(handler.shouldHandleMessage({ type } as WebviewMessage)).toBe(false)
			})
		})
	})
})
