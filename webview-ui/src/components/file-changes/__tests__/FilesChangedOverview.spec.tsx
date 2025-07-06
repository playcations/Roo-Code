// Tests for self-managing FilesChangedOverview component
// npx vitest run src/components/file-changes/__tests__/FilesChangedOverview.updated.spec.tsx

import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { vi } from "vitest"

import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"
import { FileChangeType } from "@roo-code/types"

import FilesChangedOverview from "../FilesChangedOverview"

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
			// Simple key mapping for tests
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
				"file-changes:line_changes.added": `+${options?.count || 0}`,
				"file-changes:line_changes.removed": `-${options?.count || 0}`,
				"file-changes:line_changes.added_removed": `+${options?.added || 0}, -${options?.removed || 0}`,
				"file-changes:accessibility.files_list": `${options?.count || 0} files ${options?.state || ""}`,
				"file-changes:accessibility.expanded": "expanded",
				"file-changes:accessibility.collapsed": "collapsed",
				"file-changes:header.expand": "Expand",
				"file-changes:header.collapse": "Collapse",
			}
			return translations[key] || key
		},
	}),
}))

describe("FilesChangedOverview (Self-Managing)", () => {
	const mockExtensionState = {
		filesChangedEnabled: true,
		// Other required state properties
	}

	const mockFilesChanged = [
		{
			uri: "src/components/test1.ts",
			type: "edit" as FileChangeType,
			fromCheckpoint: "hash1",
			toCheckpoint: "hash2",
			linesAdded: 10,
			linesRemoved: 5,
		},
		{
			uri: "src/components/test2.ts",
			type: "create" as FileChangeType,
			fromCheckpoint: "hash1",
			toCheckpoint: "hash2",
			linesAdded: 25,
			linesRemoved: 0,
		},
	]

	const mockChangeset = {
		baseCheckpoint: "hash1",
		files: mockFilesChanged,
	}

	beforeEach(() => {
		vi.clearAllMocks()
		// Mock window.addEventListener for message handling
		vi.spyOn(window, "addEventListener")
		vi.spyOn(window, "removeEventListener")
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	const renderComponent = () => {
		return render(
			<ExtensionStateContext.Provider value={mockExtensionState as any}>
				<FilesChangedOverview />
			</ExtensionStateContext.Provider>,
		)
	}

	// Helper to simulate messages from backend
	const simulateMessage = (message: any) => {
		const messageEvent = new MessageEvent("message", {
			data: message,
		})
		window.dispatchEvent(messageEvent)
	}

	it("should render without errors when no files changed", () => {
		renderComponent()
		// Component should not render anything when no files
		expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
	})

	it("should listen for window messages on mount", () => {
		renderComponent()
		expect(window.addEventListener).toHaveBeenCalledWith("message", expect.any(Function))
	})

	it("should remove event listener on unmount", () => {
		const { unmount } = renderComponent()
		unmount()
		expect(window.removeEventListener).toHaveBeenCalledWith("message", expect.any(Function))
	})

	it("should display files when receiving filesChanged message", async () => {
		renderComponent()

		// Simulate receiving filesChanged message
		simulateMessage({
			type: "filesChanged",
			filesChanged: mockChangeset,
		})

		await waitFor(() => {
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})

		// Check header shows file count
		expect(screen.getByTestId("files-changed-header")).toHaveTextContent("2 files changed")
	})

	it("should handle checkpoint_created message", async () => {
		renderComponent()

		// Simulate checkpoint created event
		simulateMessage({
			type: "checkpoint_created",
			checkpoint: "new-checkpoint-hash",
			previousCheckpoint: "previous-hash",
		})

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "filesChangedRequest",
			})
		})
	})

	it("should handle checkpoint_restored message", async () => {
		renderComponent()

		// First set up some files
		simulateMessage({
			type: "filesChanged",
			filesChanged: mockChangeset,
		})

		await waitFor(() => {
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})

		// Simulate checkpoint restore
		simulateMessage({
			type: "checkpoint_restored",
			checkpoint: "restored-checkpoint-hash",
		})

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "filesChangedBaselineUpdate",
				baseline: "restored-checkpoint-hash",
			})
		})
	})

	it("should expand/collapse when header is clicked", async () => {
		renderComponent()

		// Add some files first
		simulateMessage({
			type: "filesChanged",
			filesChanged: mockChangeset,
		})

		await waitFor(() => {
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})

		// Component should start collapsed
		expect(screen.queryByTestId("file-item-src/components/test1.ts")).not.toBeInTheDocument()

		// Click to expand
		const header = screen.getByTestId("files-changed-header").closest('[role="button"]')
		fireEvent.click(header!)

		await waitFor(() => {
			expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
		})
	})

	it("should send accept file message when accept button clicked", async () => {
		renderComponent()

		// Add files and expand
		simulateMessage({
			type: "filesChanged",
			filesChanged: mockChangeset,
		})

		await waitFor(() => {
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})

		// Expand to show files
		const header = screen.getByTestId("files-changed-header").closest('[role="button"]')
		fireEvent.click(header!)

		await waitFor(() => {
			expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
		})

		// Click accept button
		const acceptButton = screen.getByTestId("accept-src/components/test1.ts")
		fireEvent.click(acceptButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "acceptFileChange",
			uri: "src/components/test1.ts",
		})
	})

	it("should send reject file message when reject button clicked", async () => {
		renderComponent()

		// Add files and expand
		simulateMessage({
			type: "filesChanged",
			filesChanged: mockChangeset,
		})

		await waitFor(() => {
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})

		// Expand to show files
		const header = screen.getByTestId("files-changed-header").closest('[role="button"]')
		fireEvent.click(header!)

		await waitFor(() => {
			expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
		})

		// Click reject button
		const rejectButton = screen.getByTestId("reject-src/components/test1.ts")
		fireEvent.click(rejectButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "rejectFileChange",
			uri: "src/components/test1.ts",
		})
	})

	it("should send accept all message when accept all button clicked", async () => {
		renderComponent()

		// Add files
		simulateMessage({
			type: "filesChanged",
			filesChanged: mockChangeset,
		})

		await waitFor(() => {
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})

		// Click accept all button
		const acceptAllButton = screen.getByTestId("accept-all-button")
		fireEvent.click(acceptAllButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "acceptAllFileChanges",
		})
	})

	it("should send reject all message when reject all button clicked", async () => {
		renderComponent()

		// Add files
		simulateMessage({
			type: "filesChanged",
			filesChanged: mockChangeset,
		})

		await waitFor(() => {
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})

		// Click reject all button
		const rejectAllButton = screen.getByTestId("reject-all-button")
		fireEvent.click(rejectAllButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "rejectAllFileChanges",
		})
	})

	it("should filter out accepted files from display", async () => {
		renderComponent()

		// Add files
		simulateMessage({
			type: "filesChanged",
			filesChanged: mockChangeset,
		})

		await waitFor(() => {
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})

		// Expand to show files
		const header = screen.getByTestId("files-changed-header").closest('[role="button"]')
		fireEvent.click(header!)

		await waitFor(() => {
			expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			expect(screen.getByTestId("file-item-src/components/test2.ts")).toBeInTheDocument()
		})

		// Accept one file
		const acceptButton = screen.getByTestId("accept-src/components/test1.ts")
		fireEvent.click(acceptButton)

		// File should be filtered out from display
		await waitFor(() => {
			expect(screen.queryByTestId("file-item-src/components/test1.ts")).not.toBeInTheDocument()
			expect(screen.getByTestId("file-item-src/components/test2.ts")).toBeInTheDocument()
		})
	})

	it("should not render when filesChangedEnabled is false", () => {
		const disabledState = { ...mockExtensionState, filesChangedEnabled: false }

		render(
			<ExtensionStateContext.Provider value={disabledState as any}>
				<FilesChangedOverview />
			</ExtensionStateContext.Provider>,
		)

		// Add files
		simulateMessage({
			type: "filesChanged",
			filesChanged: mockChangeset,
		})

		// Component should not render when disabled
		expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
	})

	it("should clear files when receiving empty filesChanged message", async () => {
		renderComponent()

		// First add files
		simulateMessage({
			type: "filesChanged",
			filesChanged: mockChangeset,
		})

		await waitFor(() => {
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})

		// Clear files with empty message
		simulateMessage({
			type: "filesChanged",
			filesChanged: undefined,
		})

		await waitFor(() => {
			expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
		})
	})
})
