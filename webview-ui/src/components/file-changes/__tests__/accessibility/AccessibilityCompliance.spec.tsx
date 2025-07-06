// Comprehensive accessibility tests for self-managing FilesChangedOverview
// npx vitest run src/components/file-changes/__tests__/accessibility/AccessibilityCompliance.spec.tsx

import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { vi } from "vitest"

import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
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

describe("FilesChangedOverview - Accessibility Compliance (Self-Managing)", () => {
	const mockExtensionState = {
		filesChangedEnabled: true,
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
		files: mockFilesChanged,
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

	describe("ARIA Compliance", () => {
		it("should have proper ARIA role for main interactive element", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")
			expect(header).toHaveAttribute("role", "button")
			expect(header).toHaveAttribute("aria-expanded", "false")
		})

		it("should have descriptive ARIA labels", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")
			expect(header).toHaveAttribute("aria-label")

			const ariaLabel = header.getAttribute("aria-label")
			expect(ariaLabel).toContain("3 files")
			expect(ariaLabel).toContain("collapsed")
		})

		it("should update ARIA labels when state changes", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")
			expect(header).toHaveAttribute("aria-expanded", "false")

			// Expand
			fireEvent.click(header)
			await waitFor(() => {
				expect(header).toHaveAttribute("aria-expanded", "true")
			})

			const expandedAriaLabel = header.getAttribute("aria-label")
			expect(expandedAriaLabel).toContain("expanded")
		})

		it("should have proper ARIA attributes for all interactive elements", async () => {
			await setupComponentWithFiles()

			const acceptAllButton = screen.getByTestId("accept-all-button")
			const rejectAllButton = screen.getByTestId("reject-all-button")

			expect(acceptAllButton).toHaveAttribute("title", "Accept All")
			expect(rejectAllButton).toHaveAttribute("title", "Reject All")
			expect(acceptAllButton).toHaveAttribute("tabIndex", "0")
			expect(rejectAllButton).toHaveAttribute("tabIndex", "0")
		})

		it("should provide meaningful tooltips for all actions", async () => {
			await setupComponentWithFiles()

			// Expand to show individual file actions
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			const viewDiffButton = screen.getByTestId("diff-src/components/test1.ts")
			const acceptButton = screen.getByTestId("accept-src/components/test1.ts")
			const rejectButton = screen.getByTestId("reject-src/components/test1.ts")

			expect(viewDiffButton).toHaveAttribute("title", "View Diff")
			expect(acceptButton).toHaveAttribute("title", "Accept")
			expect(rejectButton).toHaveAttribute("title", "Reject")
		})

		it("should have accessible file-level controls when expanded", async () => {
			await setupComponentWithFiles()

			// Expand to show files
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			// Check each file has accessible controls
			mockFilesChanged.forEach((file) => {
				const fileItem = screen.getByTestId(`file-item-${file.uri}`)
				expect(fileItem).toBeInTheDocument()

				const viewDiffButton = screen.getByTestId(`diff-${file.uri}`)
				const acceptButton = screen.getByTestId(`accept-${file.uri}`)
				const rejectButton = screen.getByTestId(`reject-${file.uri}`)

				expect(viewDiffButton).toHaveAttribute("tabIndex", "-1") // May be disabled for some types
				expect(acceptButton).toHaveAttribute("tabIndex", "-1")
				expect(rejectButton).toHaveAttribute("tabIndex", "-1")
			})
		})
	})

	describe("Keyboard Navigation", () => {
		it("should be keyboard navigable with Tab key", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")
			const acceptAllButton = screen.getByTestId("accept-all-button")
			const rejectAllButton = screen.getByTestId("reject-all-button")

			// All main controls should be tabbable
			expect(header).toHaveAttribute("tabIndex", "0")
			expect(acceptAllButton).toHaveAttribute("tabIndex", "0")
			expect(rejectAllButton).toHaveAttribute("tabIndex", "0")
		})

		it("should respond to Enter key on main button", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")
			expect(header).toHaveAttribute("aria-expanded", "false")

			fireEvent.keyDown(header, { key: "Enter" })

			await waitFor(() => {
				expect(header).toHaveAttribute("aria-expanded", "true")
			})
		})

		it("should respond to Space key on main button", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")
			expect(header).toHaveAttribute("aria-expanded", "false")

			fireEvent.keyDown(header, { key: " " })

			await waitFor(() => {
				expect(header).toHaveAttribute("aria-expanded", "true")
			})
		})

		it("should prevent default browser behavior for keyboard events", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")

			// Simulate the event handling that happens in the component
			fireEvent.keyDown(header, { key: "Enter" })
			fireEvent.keyDown(header, { key: " " })

			// The component should handle these keys (checking via state change)
			await waitFor(() => {
				expect(header).toHaveAttribute("aria-expanded", "true")
			})
		})

		it("should maintain focus management when expanding/collapsing", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")
			header.focus()

			expect(document.activeElement).toBe(header)

			fireEvent.click(header)

			await waitFor(() => {
				expect(header).toHaveAttribute("aria-expanded", "true")
			})

			// Focus should remain on header after expanding
			expect(document.activeElement).toBe(header)
		})

		it("should have logical tab order when files are expanded", async () => {
			await setupComponentWithFiles()

			// Expand to show files
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			// Check that action buttons maintain proper tab order
			const acceptAllButton = screen.getByTestId("accept-all-button")
			const rejectAllButton = screen.getByTestId("reject-all-button")

			expect(acceptAllButton).toHaveAttribute("tabIndex", "0")
			expect(rejectAllButton).toHaveAttribute("tabIndex", "0")

			// Individual file controls should be accessible but may have different tab index
			const firstFileAcceptButton = screen.getByTestId("accept-src/components/test1.ts")
			expect(firstFileAcceptButton).toHaveAttribute("tabIndex") // Should have some tab index
		})
	})

	describe("Screen Reader Support", () => {
		it("should provide meaningful text content for screen readers", async () => {
			await setupComponentWithFiles()

			const header = screen.getByTestId("files-changed-header")
			expect(header).toHaveTextContent("3 files changed")

			// Expand and check file information
			const headerButton = screen.getByRole("button")
			fireEvent.click(headerButton)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			// Check file details are readable
			const fileItem = screen.getByTestId("file-item-src/components/test1.ts")
			expect(fileItem).toHaveTextContent("src/components/test1.ts")
			expect(fileItem).toHaveTextContent("Modified") // File type
		})

		it("should announce state changes appropriately", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")

			// Check initial state
			expect(header).toHaveAttribute("aria-expanded", "false")

			// State should change when toggled
			fireEvent.click(header)

			await waitFor(() => {
				expect(header).toHaveAttribute("aria-expanded", "true")
			})

			// Check that aria-label reflects new state
			const ariaLabel = header.getAttribute("aria-label")
			expect(ariaLabel).toContain("expanded")
		})

		it("should provide context for file change information", async () => {
			await setupComponentWithFiles()

			// Expand to show files
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			// Check that each file type is properly labeled
			const editedFile = screen.getByTestId("file-item-src/components/test1.ts")
			const createdFile = screen.getByTestId("file-item-src/utils/test2.ts")
			const deletedFile = screen.getByTestId("file-item-docs/readme.md")

			expect(editedFile).toHaveTextContent("Modified")
			expect(createdFile).toHaveTextContent("Created")
			expect(deletedFile).toHaveTextContent("Deleted")
		})
	})

	describe("Color and Contrast", () => {
		it("should use semantic colors accessible to colorblind users", async () => {
			await setupComponentWithFiles()

			// Component should rely on VS Code theme colors which are accessible
			const overview = screen.getByTestId("files-changed-overview")
			expect(overview).toHaveStyle({
				backgroundColor: "var(--vscode-editor-background)",
				border: "1px solid var(--vscode-panel-border)",
			})
		})

		it("should not rely solely on color to convey information", async () => {
			await setupComponentWithFiles()

			// Expand to show files
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			// Information should be conveyed through text, not just color
			const editedFile = screen.getByTestId("file-item-src/components/test1.ts")
			expect(editedFile).toHaveTextContent("Modified") // Text label, not just color
			expect(editedFile).toHaveTextContent("+10") // Line changes as text
		})
	})

	describe("Focus Management", () => {
		it("should properly manage focus when component mounts with data", async () => {
			// Component should not steal focus when it appears
			renderComponent()

			const button = document.createElement("button")
			document.body.appendChild(button)
			button.focus()

			simulateMessage({
				type: "filesChanged",
				filesChanged: mockChangeset,
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Focus should not have moved to the FCO
			expect(document.activeElement).toBe(button)

			document.body.removeChild(button)
		})

		it("should handle focus when component unmounts", async () => {
			await setupComponentWithFiles()

			const header = screen.getByRole("button")
			header.focus()

			// Clear the component
			simulateMessage({
				type: "filesChanged",
				filesChanged: undefined,
			})

			await waitFor(() => {
				expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
			})

			// Should not cause focus issues
			expect(document.activeElement).toBeTruthy()
		})
	})
})
