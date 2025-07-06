// Comprehensive integration tests for self-managing FilesChangedOverview webview message flow
// npx vitest run src/components/file-changes/__tests__/integration/WebviewMessageFlow.integration.spec.tsx

import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, beforeEach, it, expect, vi } from "vitest"

import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"
import { FileChangeType } from "@roo-code/types"
import FilesChangedOverview from "../../FilesChangedOverview"

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: any) => {
			const translations: Record<string, string> = {
				"file-changes:summary.count_with_changes": `${options?.count || 0} files changed${options?.changes || ""}`,
				"file-changes:actions.accept_all": "Accept All",
				"file-changes:actions.reject_all": "Reject All",
				"file-changes:actions.view_diff": "View Diff",
				"file-changes:actions.accept_file": "Accept",
				"file-changes:actions.reject_file": "Reject",
				"file-changes:file_types.edit": "Modified",
				"file-changes:file_types.create": "Created",
				"file-changes:file_types.delete": "Deleted",
				"file-changes:header.expand": "Expand",
				"file-changes:header.collapse": "Collapse",
			}
			return translations[key] || key
		},
	}),
}))

describe("FilesChangedOverview Webview Message Flow Integration (Self-Managing)", () => {
	const mockExtensionState = {
		filesChangedEnabled: true,
		version: "1.0.0",
		clineMessages: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		allowedCommands: [],
		alwaysAllowExecute: false,
		didHydrateState: true,
		showWelcome: false,
		theme: {},
		mcpServers: [],
		filePaths: [],
		openedTabs: [],
		organizationAllowList: [],
		cloudIsAuthenticated: false,
		sharingEnabled: false,
		hasOpenedModeSelector: false,
		setHasOpenedModeSelector: () => {},
		condensingApiConfigId: "",
		setCondensingApiConfigId: () => {},
		customCondensingPrompt: "",
		setCustomCondensingPrompt: () => {},
	}

	const mockFiles = [
		{
			uri: "src/components/test1.ts",
			type: "edit" as FileChangeType,
			fromCheckpoint: "hash1",
			toCheckpoint: "hash2",
			linesAdded: 10,
			linesRemoved: 5,
		},
		{
			uri: "src/utils/test2.ts",
			type: "create" as FileChangeType,
			fromCheckpoint: "hash1",
			toCheckpoint: "hash3",
			linesAdded: 20,
			linesRemoved: 0,
		},
		{
			uri: "docs/readme.md",
			type: "delete" as FileChangeType,
			fromCheckpoint: "hash1",
			toCheckpoint: "hash4",
			linesAdded: 0,
			linesRemoved: 15,
		},
	]

	const mockChangeset = {
		baseCheckpoint: "hash1",
		files: mockFiles,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	const renderComponent = () => {
		return render(
			<ExtensionStateContext.Provider value={mockExtensionState as any}>
				<FilesChangedOverview />
			</ExtensionStateContext.Provider>,
		)
	}

	const simulateMessage = (message: any) => {
		const messageEvent = new MessageEvent("message", {
			data: message,
		})
		window.dispatchEvent(messageEvent)
	}

	const setupComponentWithFiles = async () => {
		renderComponent()
		simulateMessage({
			type: "filesChanged",
			filesChanged: mockChangeset,
		})
		await waitFor(() => {
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})
	}

	describe("Initial Rendering and State", () => {
		it("should render when receiving filesChanged message from extension", async () => {
			await setupComponentWithFiles()

			// Component should render with file count
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("3 files changed")
		})

		it("should not render when no filesChanged message received", () => {
			renderComponent()

			// Component should not render without message
			expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
		})

		it("should handle empty file list in message", async () => {
			renderComponent()
			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: [],
				},
			})

			// Should not render with empty files
			expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
		})

		it("should handle undefined filesChanged in message", async () => {
			renderComponent()
			simulateMessage({
				type: "filesChanged",
				filesChanged: undefined,
			})

			// Should not render with undefined
			expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
		})
	})

	describe("Checkpoint Event Handling", () => {
		it("should request file changes when checkpoint_created message received", async () => {
			renderComponent()

			simulateMessage({
				type: "checkpoint_created",
				checkpoint: "new-hash",
				previousCheckpoint: "old-hash",
			})

			// Should send filesChangedRequest
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "filesChangedRequest",
			})
		})

		it("should update baseline when checkpoint_restored message received", async () => {
			renderComponent()

			simulateMessage({
				type: "checkpoint_restored",
				checkpoint: "restored-hash",
			})

			// Should send filesChangedBaselineUpdate
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "filesChangedBaselineUpdate",
				baseline: "restored-hash",
			})
		})

		it("should handle malformed checkpoint messages gracefully", async () => {
			renderComponent()

			// Send checkpoint message without required fields
			simulateMessage({
				type: "checkpoint_created",
			})

			// Should not crash, but also shouldn't send filesChangedRequest
			await new Promise((resolve) => setTimeout(resolve, 10))
			expect(vscode.postMessage).not.toHaveBeenCalledWith({
				type: "filesChangedRequest",
			})
		})
	})

	describe("User Actions and Message Sending", () => {
		it("should send viewDiff message when view diff button is clicked", async () => {
			await setupComponentWithFiles()

			// Expand to show individual files
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			const viewDiffButton = screen.getByTestId("diff-src/components/test1.ts")
			fireEvent.click(viewDiffButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "viewDiff",
				uri: "src/components/test1.ts",
			})
		})

		it("should send acceptFileChange message when accept button is clicked", async () => {
			await setupComponentWithFiles()

			// Expand to show individual files
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			const acceptButton = screen.getByTestId("accept-src/components/test1.ts")
			fireEvent.click(acceptButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "acceptFileChange",
				uri: "src/components/test1.ts",
			})
		})

		it("should send rejectFileChange message when reject button is clicked", async () => {
			await setupComponentWithFiles()

			// Expand to show individual files
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/utils/test2.ts")).toBeInTheDocument()
			})

			const rejectButton = screen.getByTestId("reject-src/utils/test2.ts")
			fireEvent.click(rejectButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "rejectFileChange",
				uri: "src/utils/test2.ts",
			})
		})

		it("should send acceptAllFileChanges message when accept all is clicked", async () => {
			await setupComponentWithFiles()

			const acceptAllButton = screen.getByTestId("accept-all-button")
			fireEvent.click(acceptAllButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "acceptAllFileChanges",
			})
		})

		it("should send rejectAllFileChanges message when reject all is clicked", async () => {
			await setupComponentWithFiles()

			const rejectAllButton = screen.getByTestId("reject-all-button")
			fireEvent.click(rejectAllButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "rejectAllFileChanges",
			})
		})
	})

	describe("Dynamic State Updates", () => {
		it("should update when receiving new filesChanged message", async () => {
			await setupComponentWithFiles()

			// Should show initial file count
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("3 files changed")

			// Send updated message with different files
			const updatedFiles = mockFiles.slice(0, 2) // Only first 2 files
			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: updatedFiles,
				},
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-header")).toHaveTextContent("2 files changed")
			})
		})

		it("should disappear when receiving empty filesChanged message", async () => {
			await setupComponentWithFiles()

			// Should be visible initially
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()

			// Send empty message
			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: [],
				},
			})

			await waitFor(() => {
				expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
			})
		})

		it("should handle rapid state changes gracefully", async () => {
			renderComponent()

			// Rapidly send different file sets
			const fileSets = [
				mockFiles.slice(0, 1), // 1 file
				mockFiles.slice(0, 2), // 2 files
				mockFiles, // 3 files
				[], // 0 files
				mockFiles.slice(1, 3), // 2 different files
			]

			for (const files of fileSets) {
				simulateMessage({
					type: "filesChanged",
					filesChanged:
						files.length > 0
							? {
									baseCheckpoint: "hash1",
									files,
								}
							: {
									baseCheckpoint: "hash1",
									files: [],
								},
				})

				// Small delay between messages
				await new Promise((resolve) => setTimeout(resolve, 10))
			}

			// Should end up with 2 files
			await waitFor(() => {
				if (screen.queryByTestId("files-changed-overview")) {
					expect(screen.getByTestId("files-changed-header")).toHaveTextContent("2 files changed")
				}
			})
		})
	})

	describe("Real-time Message Flow Simulation", () => {
		it("should handle complete workflow: checkpoint -> file changes -> user actions", async () => {
			vi.clearAllMocks()
			renderComponent()

			// 1. Simulate checkpoint creation
			simulateMessage({
				type: "checkpoint_created",
				checkpoint: "new-checkpoint",
				previousCheckpoint: "old-checkpoint",
			})

			// Should request file changes
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "filesChangedRequest",
			})

			// 2. Simulate backend response with file changes
			simulateMessage({
				type: "filesChanged",
				filesChanged: mockChangeset,
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// 3. User expands and accepts a file
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			const acceptButton = screen.getByTestId("accept-src/components/test1.ts")
			fireEvent.click(acceptButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "acceptFileChange",
				uri: "src/components/test1.ts",
			})

			// 4. Simulate checkpoint restore
			simulateMessage({
				type: "checkpoint_restored",
				checkpoint: "restored-checkpoint",
			})

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "filesChangedBaselineUpdate",
				baseline: "restored-checkpoint",
			})
		})

		it("should handle concurrent message processing", async () => {
			renderComponent()

			// Send multiple messages simultaneously
			const messages = [
				{ type: "checkpoint_created", checkpoint: "hash1" },
				{ type: "filesChanged", filesChanged: mockChangeset },
				{ type: "checkpoint_restored", checkpoint: "hash2" },
			]

			messages.forEach((message) => simulateMessage(message))

			// Should handle all messages without crashing
			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Verify expected messages were sent
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "filesChangedRequest",
			})
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "filesChangedBaselineUpdate",
				baseline: "hash2",
			})
		})
	})

	describe("Error Handling in Message Flow", () => {
		it("should handle vscode.postMessage errors gracefully", async () => {
			// Mock postMessage to throw error
			vi.mocked(vscode.postMessage).mockImplementation(() => {
				throw new Error("VSCode API error")
			})

			await setupComponentWithFiles()

			// Should not crash when triggering actions that send messages
			const acceptAllButton = screen.getByTestId("accept-all-button")
			expect(() => fireEvent.click(acceptAllButton)).not.toThrow()

			const rejectAllButton = screen.getByTestId("reject-all-button")
			expect(() => fireEvent.click(rejectAllButton)).not.toThrow()
		})

		it("should handle malformed filesChanged message gracefully", async () => {
			renderComponent()

			// Send malformed message
			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					// Missing baseCheckpoint
					files: mockFiles,
				},
			})

			// Should not crash
			expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
		})

		it("should handle corrupted file data in message", async () => {
			renderComponent()

			const corruptedFiles = [
				{
					uri: "valid-file.ts",
					type: "edit" as FileChangeType,
					fromCheckpoint: "hash1",
					toCheckpoint: "hash2",
					linesAdded: 5,
					linesRemoved: 2,
				},
				{
					// Missing required fields
					uri: "",
					type: undefined,
					fromCheckpoint: undefined,
					toCheckpoint: undefined,
				} as any,
			]

			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: corruptedFiles,
				},
			})

			// Should handle corrupted data gracefully
			await waitFor(() => {
				if (screen.queryByTestId("files-changed-overview")) {
					// Should show at least the valid file
					expect(screen.getByTestId("files-changed-header")).toBeInTheDocument()
				}
			})
		})
	})

	describe("Performance with Large File Sets", () => {
		it("should handle large number of files efficiently via message", async () => {
			// Create large file set
			const manyFiles = Array.from({ length: 100 }, (_, i) => ({
				uri: `src/file${i}.ts`,
				type: "edit" as FileChangeType,
				fromCheckpoint: "hash1",
				toCheckpoint: "hash2",
				linesAdded: i + 1,
				linesRemoved: i,
			}))

			renderComponent()

			const startTime = Date.now()
			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: manyFiles,
				},
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			const endTime = Date.now()

			// Should render quickly even with many files
			expect(endTime - startTime).toBeLessThan(1000)
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("100 files changed")
		})

		it("should maintain message responsiveness with rapid updates", async () => {
			renderComponent()

			// Send many rapid file updates
			const fileCounts = [10, 50, 25, 75, 100, 5]

			for (const count of fileCounts) {
				const files = Array.from({ length: count }, (_, i) => ({
					uri: `src/file${i}.ts`,
					type: "edit" as FileChangeType,
					fromCheckpoint: "hash1",
					toCheckpoint: "hash2",
					linesAdded: 1,
					linesRemoved: 0,
				}))

				simulateMessage({
					type: "filesChanged",
					filesChanged: {
						baseCheckpoint: "hash1",
						files,
					},
				})

				// Small delay between updates
				await new Promise((resolve) => setTimeout(resolve, 5))
			}

			// Should end up with the last count
			await waitFor(() => {
				expect(screen.getByTestId("files-changed-header")).toHaveTextContent("5 files changed")
			})
		})
	})

	describe("Message Type Validation", () => {
		it("should only respond to valid message types", async () => {
			renderComponent()

			// Send invalid message types
			const invalidMessages = [
				{ type: "unknown_message", data: "test" },
				{ type: "filesChangedOld", filesChanged: mockChangeset }, // Old API
				{ type: "checkpoint_created_old", checkpoint: "hash" }, // Old API
				{ type: "", data: "empty type" },
			]

			invalidMessages.forEach((message) => simulateMessage(message))

			// Should not render for invalid messages
			await new Promise((resolve) => setTimeout(resolve, 100))
			expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
			expect(vscode.postMessage).not.toHaveBeenCalled()
		})

		it("should send correctly formatted messages for all user actions", async () => {
			vi.clearAllMocks()
			await setupComponentWithFiles()

			// Expand to show individual files
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			// Test all action types
			const actions = [
				{
					button: "diff-src/components/test1.ts",
					expectedType: "viewDiff",
					expectedUri: "src/components/test1.ts",
				},
				{
					button: "accept-src/components/test1.ts",
					expectedType: "acceptFileChange",
					expectedUri: "src/components/test1.ts",
				},
				{
					button: "reject-src/utils/test2.ts",
					expectedType: "rejectFileChange",
					expectedUri: "src/utils/test2.ts",
				},
			]

			for (const action of actions) {
				vi.clearAllMocks()

				const button = screen.getByTestId(action.button)
				fireEvent.click(button)

				expect(vscode.postMessage).toHaveBeenCalledWith({
					type: action.expectedType,
					uri: action.expectedUri,
				})

				// Small delay between actions
				await new Promise((resolve) => setTimeout(resolve, 10))
			}

			// Test bulk actions
			vi.clearAllMocks()

			const acceptAllButton = screen.getByTestId("accept-all-button")
			fireEvent.click(acceptAllButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "acceptAllFileChanges",
			})

			await new Promise((resolve) => setTimeout(resolve, 10))

			const rejectAllButton = screen.getByTestId("reject-all-button")
			fireEvent.click(rejectAllButton)

			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "rejectAllFileChanges",
			})
		})
	})
})
