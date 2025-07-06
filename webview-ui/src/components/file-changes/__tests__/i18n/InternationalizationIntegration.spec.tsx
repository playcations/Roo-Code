// Comprehensive internationalization integration tests for self-managing FilesChangedOverview
// npx vitest run src/components/file-changes/__tests__/i18n/InternationalizationIntegration.spec.tsx

import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { vi } from "vitest"

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

// Mock react-i18next with realistic translations
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: any) => {
			const translations: Record<string, string> = {
				// Summary and count translations
				"file-changes:summary.count_with_changes": `${options?.count || 0} files changed${options?.changes || ""}`,
				"file-changes:summary.count_only": `${options?.count || 0} files changed`,

				// Header translations
				"file-changes:header.expand": "Expand files list",
				"file-changes:header.collapse": "Collapse files list",

				// Action translations
				"file-changes:actions.accept_all": "Accept All",
				"file-changes:actions.reject_all": "Reject All",
				"file-changes:actions.view_diff": "View Diff",
				"file-changes:actions.accept_file": "Accept changes for this file",
				"file-changes:actions.reject_file": "Reject changes for this file",

				// File type translations
				"file-changes:file_types.edit": "edit",
				"file-changes:file_types.create": "create",
				"file-changes:file_types.delete": "delete",

				// Line change translations
				"file-changes:line_changes.added": `+${options?.count || 0}`,
				"file-changes:line_changes.removed": `-${options?.count || 0}`,
				"file-changes:line_changes.added_removed": `+${options?.added || 0}, -${options?.removed || 0} lines`,
				"file-changes:line_changes.deleted": "deleted",
				"file-changes:line_changes.modified": "modified",

				// Accessibility translations
				"file-changes:accessibility.files_list": `Files list with ${options?.count || 0} files ${options?.state || ""}`,
				"file-changes:accessibility.expanded": "expanded",
				"file-changes:accessibility.collapsed": "collapsed",
			}
			return translations[key] || key
		},
	}),
}))

describe("FilesChangedOverview Internationalization Integration (Self-Managing)", () => {
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

	describe("Translation Integration", () => {
		it("should use useTranslation hook correctly", async () => {
			await setupComponentWithFiles()

			// Component should render without errors using translations
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			expect(screen.getByRole("button")).toBeInTheDocument()
		})

		it("should display translated text (not translation keys)", async () => {
			await setupComponentWithFiles()

			// All text should be translated, not showing translation keys
			const header = screen.getByTestId("files-changed-header")
			const headerText = header.textContent || ""

			// Should not contain translation keys
			expect(headerText).not.toContain("file-changes:")
			expect(headerText).not.toContain("{{")
			expect(headerText).not.toContain("}}")

			// Should contain expected English text
			expect(headerText).toContain("files changed")
		})

		it("should properly interpolate variables in translations", async () => {
			await setupComponentWithFiles()

			// Check that file count is properly interpolated
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("3 files changed")

			// Check that change counts are interpolated
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("(+30, -20)")
		})

		it("should translate all interactive elements", async () => {
			await setupComponentWithFiles()

			// All buttons should have translated text/tooltips
			expect(screen.getByTestId("accept-all-button")).toHaveAttribute("title", "Accept All")
			expect(screen.getByTestId("reject-all-button")).toHaveAttribute("title", "Reject All")
		})

		it("should translate file-level elements when expanded", async () => {
			await setupComponentWithFiles()

			// Expand to see file details
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			// File type labels should be translated
			expect(screen.getByTestId("file-item-src/components/test1.ts")).toHaveTextContent("edit")
			expect(screen.getByTestId("file-item-src/utils/test2.ts")).toHaveTextContent("create")
			expect(screen.getByTestId("file-item-docs/readme.md")).toHaveTextContent("delete")

			// Action button tooltips should be translated
			expect(screen.getByTestId("diff-src/components/test1.ts")).toHaveAttribute("title", "View Diff")
			expect(screen.getByTestId("accept-src/components/test1.ts")).toHaveAttribute(
				"title",
				"Accept changes for this file",
			)
			expect(screen.getByTestId("reject-src/components/test1.ts")).toHaveAttribute(
				"title",
				"Reject changes for this file",
			)
		})

		it("should translate line change descriptions", async () => {
			await setupComponentWithFiles()

			// Expand to see file details
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/components/test1.ts")).toBeInTheDocument()
			})

			// Check line change translations
			expect(screen.getByTestId("file-item-src/components/test1.ts")).toHaveTextContent("+10, -5 lines") // edit file
			expect(screen.getByTestId("file-item-src/utils/test2.ts")).toHaveTextContent("+20") // create file
			expect(screen.getByTestId("file-item-docs/readme.md")).toHaveTextContent("deleted") // delete file
		})
	})

	describe("Translation Keys Coverage", () => {
		it("should use all expected translation namespaces", async () => {
			await setupComponentWithFiles()

			// The component should use translations from the file-changes namespace
			// This test verifies that our mock is being called with the right keys

			// Check header translations are called
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("files changed")

			// Check action translations are called
			expect(screen.getByTestId("accept-all-button")).toHaveAttribute("title", "Accept All")
			expect(screen.getByTestId("reject-all-button")).toHaveAttribute("title", "Reject All")
		})

		it("should handle empty file sets correctly", async () => {
			renderComponent()

			// Send empty file list
			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: [],
				},
			})

			// Should not render when no files
			expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
		})

		it("should translate accessibility labels", async () => {
			await setupComponentWithFiles()

			// Check ARIA labels are translated
			const header = screen.getByRole("button")
			expect(header).toHaveAttribute("aria-label")

			const ariaLabel = header.getAttribute("aria-label")
			expect(ariaLabel).not.toContain("file-changes:")
			expect(ariaLabel).toContain("files")
		})
	})

	describe("Performance with Translations", () => {
		it("should not impact performance when rendering with translations", async () => {
			const startTime = performance.now()
			await setupComponentWithFiles()
			const renderTime = performance.now() - startTime

			// Translation should not significantly impact render time
			expect(renderTime).toBeLessThan(200) // 200ms threshold (including message simulation)

			// Component should render correctly
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("files changed")
		})

		it("should handle frequent message updates with translations efficiently", async () => {
			renderComponent()

			// Simulate multiple file updates with translation re-rendering
			const startTime = performance.now()

			for (let i = 0; i < 5; i++) {
				const updatedFiles = [
					...mockFilesChanged,
					{
						uri: `src/new-file-${i}.ts`,
						type: "create" as FileChangeType,
						fromCheckpoint: "hash1",
						toCheckpoint: `hash${i + 10}`,
						linesAdded: i * 5,
						linesRemoved: 0,
					},
				]

				simulateMessage({
					type: "filesChanged",
					filesChanged: {
						baseCheckpoint: "hash1",
						files: updatedFiles,
					},
				})

				// Small delay to simulate real usage
				await new Promise((resolve) => setTimeout(resolve, 5))
			}

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-header")).toHaveTextContent("4 files changed")
			})

			const totalTime = performance.now() - startTime

			// Multiple updates should still be fast
			expect(totalTime).toBeLessThan(500) // 500ms for 5 updates with delays

			// Final state should be correct (3 original + 1 added in last iteration = 4 total)
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("4 files changed")
		})
	})

	describe("Edge Cases with Translations", () => {
		it("should handle special characters in file paths with translations", async () => {
			renderComponent()

			const specialFiles = [
				{
					uri: "src/files with spaces.ts",
					type: "edit" as FileChangeType,
					fromCheckpoint: "hash1",
					toCheckpoint: "hash2",
					linesAdded: 1,
					linesRemoved: 0,
				},
				{
					uri: "src/files-with-unicode-éñ.ts",
					type: "create" as FileChangeType,
					fromCheckpoint: "hash1",
					toCheckpoint: "hash3",
					linesAdded: 5,
					linesRemoved: 0,
				},
			]

			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: specialFiles,
				},
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Translation should work with special character files
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("2 files changed")

			// Expand to check file details
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("file-item-src/files with spaces.ts")).toBeInTheDocument()
			})

			// Files with special characters should display correctly
			expect(screen.getByTestId("file-item-src/files with spaces.ts")).toBeInTheDocument()
			expect(screen.getByTestId("file-item-src/files-with-unicode-éñ.ts")).toBeInTheDocument()
		})

		it("should maintain translation consistency across state changes", async () => {
			await setupComponentWithFiles()

			// Verify initial translations
			expect(screen.getByTestId("accept-all-button")).toHaveAttribute("title", "Accept All")
			expect(screen.getByTestId("reject-all-button")).toHaveAttribute("title", "Reject All")

			// Change state and verify translations remain consistent
			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "hash1",
					files: [mockFilesChanged[0]], // Only one file now
				},
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-header")).toHaveTextContent("1 files changed")
			})

			// Translations should remain consistent
			expect(screen.getByTestId("accept-all-button")).toHaveAttribute("title", "Accept All")
			expect(screen.getByTestId("reject-all-button")).toHaveAttribute("title", "Reject All")
		})

		it("should handle large file counts with proper translation interpolation", async () => {
			renderComponent()

			// Create large file set
			const manyFiles = Array.from({ length: 100 }, (_, i) => ({
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
					files: manyFiles,
				},
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Should correctly interpolate large count
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("100 files changed")
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("(+100, -0)")
		})
	})

	describe("Translation Error Handling", () => {
		it("should handle missing translation keys gracefully", async () => {
			// Override mock to simulate missing translations
			const mockUseTranslation = vi.fn().mockReturnValue({
				t: (key: string) => {
					if (key.includes("missing")) {
						return key // Return key if translation missing
					}
					return "fallback translation"
				},
			})

			vi.doMock("react-i18next", () => ({
				useTranslation: mockUseTranslation,
			}))

			await setupComponentWithFiles()

			// Component should still render with fallback translations
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})

		it("should handle translation function errors gracefully", async () => {
			// Override mock to simulate translation errors
			const mockUseTranslation = vi.fn().mockReturnValue({
				t: () => {
					throw new Error("Translation error")
				},
			})

			vi.doMock("react-i18next", () => ({
				useTranslation: mockUseTranslation,
			}))

			// Should not crash the component
			expect(() => renderComponent()).not.toThrow()
		})
	})

	describe("Message-Based Architecture with Translations", () => {
		it("should translate checkpoint-driven messages correctly", async () => {
			renderComponent()

			// Simulate checkpoint creation
			simulateMessage({
				type: "checkpoint_created",
				checkpoint: "new-hash",
			})

			// Should send request (this tests the message flow works with translations)
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "filesChangedRequest",
			})

			// Now send file changes response
			simulateMessage({
				type: "filesChanged",
				filesChanged: mockChangeset,
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Translations should work correctly in message-driven architecture
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("3 files changed")
		})

		it("should maintain translation state across checkpoint restores", async () => {
			await setupComponentWithFiles()

			// Initial state with translations
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("3 files changed")

			// Simulate checkpoint restore
			simulateMessage({
				type: "checkpoint_restored",
				checkpoint: "restored-hash",
			})

			// Should send baseline update
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "filesChangedBaselineUpdate",
				baseline: "restored-hash",
			})

			// Send new file state after restore
			simulateMessage({
				type: "filesChanged",
				filesChanged: {
					baseCheckpoint: "restored-hash",
					files: [mockFilesChanged[0]], // Only one file after restore
				},
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-header")).toHaveTextContent("1 files changed")
			})

			// Translations should work correctly after checkpoint operations
			expect(screen.getByTestId("accept-all-button")).toHaveAttribute("title", "Accept All")
		})
	})
})
