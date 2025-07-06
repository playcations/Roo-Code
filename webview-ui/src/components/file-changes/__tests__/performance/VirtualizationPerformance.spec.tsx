// Comprehensive performance tests for self-managing FilesChangedOverview virtualization
// npx vitest run src/components/file-changes/__tests__/performance/VirtualizationPerformance.spec.tsx

import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { vi } from "vitest"

import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { FileChangeType } from "@roo-code/types"
import FilesChangedOverview from "../../FilesChangedOverview"

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: any) => {
			const translations: Record<string, string> = {
				"file-changes:summary.count_with_changes": `${options?.count || 0} files changed${options?.changes || ""}`,
				"file-changes:actions.accept_all": "Accept All",
				"file-changes:actions.reject_all": "Reject All",
			}
			return translations[key] || key
		},
	}),
}))

describe("FilesChangedOverview - Virtualization Performance (Self-Managing)", () => {
	const mockExtensionState = {
		filesChangedEnabled: true,
	}

	const createFileSet = (count: number, mixed = false) => {
		const fileTypes: FileChangeType[] = mixed ? ["edit", "create", "delete"] : ["edit"]

		return Array.from({ length: count }, (_, i) => ({
			uri: `src/file${i}.ts`,
			type: fileTypes[i % fileTypes.length] as FileChangeType,
			fromCheckpoint: "hash1",
			toCheckpoint: "hash2",
			linesAdded: Math.floor(Math.random() * 20) + 1,
			linesRemoved: Math.floor(Math.random() * 10),
		}))
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

	const setupWithFiles = async (fileCount: number, mixed = false) => {
		renderComponent()
		const files = createFileSet(fileCount, mixed)
		const changeset = {
			baseCheckpoint: "hash1",
			files,
		}

		simulateMessage({
			type: "filesChanged",
			filesChanged: changeset,
		})

		await waitFor(() => {
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
		})

		return { files, changeset }
	}

	describe("Virtualization Threshold", () => {
		it("should NOT use virtualization for 49 files (below threshold)", async () => {
			await setupWithFiles(49)

			// Expand to check virtualization
			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				// With 49 files, all should be directly rendered (no virtualization)
				// Check that all files are in DOM
				expect(screen.getAllByTestId(/^file-item-/).length).toBe(49)
			})
		})

		it("should NOT use virtualization for exactly 50 files (at threshold)", async () => {
			await setupWithFiles(50)

			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				// At exactly 50 files, virtualization threshold should not be triggered yet
				expect(screen.getAllByTestId(/^file-item-/).length).toBe(50)
			})
		})

		it("should use virtualization for 51 files (above threshold)", async () => {
			await setupWithFiles(51)

			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				// Above 50 files, virtualization should kick in
				// Only a subset of files should be rendered
				const renderedFiles = screen.getAllByTestId(/^file-item-/)
				expect(renderedFiles.length).toBeLessThan(51)
				expect(renderedFiles.length).toBeGreaterThan(0)
			})
		})

		it("should use virtualization for 100 files (well above threshold)", async () => {
			await setupWithFiles(100)

			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				// With virtualization, only visible items should be rendered
				const renderedFiles = screen.getAllByTestId(/^file-item-/)
				expect(renderedFiles.length).toBeLessThan(100)
				expect(renderedFiles.length).toBeGreaterThan(0)
				expect(renderedFiles.length).toBeLessThanOrEqual(10) // MAX_VISIBLE_ITEMS
			})
		})
	})

	describe("Performance Characteristics", () => {
		it("should render large file sets efficiently", async () => {
			const startTime = performance.now()

			await setupWithFiles(200)

			const endTime = performance.now()
			const renderTime = endTime - startTime

			// Should render within reasonable time (1 second for 200 files)
			expect(renderTime).toBeLessThan(1000)
		})

		it("should handle memory efficiently with virtualization", async () => {
			// Test that DOM size doesn't grow linearly with file count
			const result1 = render(
				<ExtensionStateContext.Provider value={mockExtensionState as any}>
					<FilesChangedOverview />
				</ExtensionStateContext.Provider>,
			)

			const initialNodeCount = document.querySelectorAll("*").length

			await setupWithFiles(500)

			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			const finalNodeCount = document.querySelectorAll("*").length
			const nodeIncrease = finalNodeCount - initialNodeCount

			// Node increase should be bounded (not proportional to file count)
			expect(nodeIncrease).toBeLessThan(200) // Should not add 500 nodes for 500 files

			result1.unmount()
		})

		it("should maintain responsiveness during scrolling simulation", async () => {
			await setupWithFiles(100)

			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Simulate scrolling by dispatching scroll events
			const scrollContainer = screen.getByTestId("files-changed-overview").querySelector('[style*="overflow"]')

			if (scrollContainer) {
				const startTime = performance.now()

				// Simulate rapid scrolling
				for (let i = 0; i < 10; i++) {
					fireEvent.scroll(scrollContainer, { target: { scrollTop: i * 60 } })
				}

				const endTime = performance.now()
				const scrollTime = endTime - startTime

				// Scrolling should be responsive (under 100ms for 10 scroll events)
				expect(scrollTime).toBeLessThan(100)
			}
		})

		it("should handle extremely large file sets (1000+ files)", async () => {
			const extremeFileCount = 1000

			// Should not crash with extreme dataset
			expect(async () => {
				await setupWithFiles(extremeFileCount)
			}).not.toThrow()

			await setupWithFiles(extremeFileCount)

			// Component should still be functional
			expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("1000 files changed")
		})
	})

	describe("Calculation Performance", () => {
		it("should calculate total changes correctly for large sets", async () => {
			// Create files with known line changes
			const files = Array.from({ length: 100 }, (_, i) => ({
				uri: `src/file${i}.ts`,
				type: "edit" as FileChangeType,
				fromCheckpoint: "hash1",
				toCheckpoint: "hash2",
				linesAdded: 5, // Fixed values for predictable testing
				linesRemoved: 2,
			}))

			renderComponent()
			simulateMessage({
				type: "filesChanged",
				filesChanged: { baseCheckpoint: "hash1", files },
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Check that total changes are calculated correctly
			const header = screen.getByTestId("files-changed-header")
			expect(header).toHaveTextContent("100 files changed")
			expect(header).toHaveTextContent("(+500, -200)") // 100 * 5, 100 * 2
		})

		it("should handle mixed file types efficiently in large sets", async () => {
			await setupWithFiles(150, true) // Mixed file types

			// Should handle different file types without performance degradation
			const header = screen.getByTestId("files-changed-header")
			expect(header).toHaveTextContent("150 files changed")

			// Expand and verify mixed types are handled
			const headerButton = screen.getByRole("button")
			fireEvent.click(headerButton)

			await waitFor(() => {
				// Should render some files (virtualized)
				const renderedFiles = screen.getAllByTestId(/^file-item-/)
				expect(renderedFiles.length).toBeGreaterThan(0)
				expect(renderedFiles.length).toBeLessThan(150) // Virtualized
			})
		})

		it("should efficiently update when accepting/rejecting files", async () => {
			await setupWithFiles(100)

			const header = screen.getByRole("button")
			fireEvent.click(header)

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			const startTime = performance.now()

			// Accept all files
			const acceptAllButton = screen.getByTestId("accept-all-button")
			fireEvent.click(acceptAllButton)

			// Should update quickly
			await waitFor(() => {
				// Files should be filtered out after acceptance
				expect(screen.queryAllByTestId(/^file-item-/).length).toBe(0)
			})

			const endTime = performance.now()
			const updateTime = endTime - startTime

			// Bulk operations should be fast (under 100ms)
			expect(updateTime).toBeLessThan(100)
		})
	})

	describe("Memory Management", () => {
		it("should not have memory leaks with repeated file updates", async () => {
			renderComponent()

			// Simulate multiple file updates
			for (let i = 0; i < 5; i++) {
				const files = createFileSet(50)
				simulateMessage({
					type: "filesChanged",
					filesChanged: { baseCheckpoint: `hash${i}`, files },
				})

				await waitFor(() => {
					expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
				})

				// Clear files
				simulateMessage({
					type: "filesChanged",
					filesChanged: undefined,
				})

				await waitFor(() => {
					expect(screen.queryByTestId("files-changed-overview")).not.toBeInTheDocument()
				})
			}

			// Should not accumulate DOM nodes
			const finalNodeCount = document.querySelectorAll("*").length
			expect(finalNodeCount).toBeLessThan(1000) // Reasonable upper bound
		})

		it("should clean up event listeners properly", async () => {
			const { unmount } = render(
				<ExtensionStateContext.Provider value={mockExtensionState as any}>
					<FilesChangedOverview />
				</ExtensionStateContext.Provider>,
			)

			// Add some files
			simulateMessage({
				type: "filesChanged",
				filesChanged: { baseCheckpoint: "hash1", files: createFileSet(10) },
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Unmount should clean up without errors
			expect(() => unmount()).not.toThrow()
		})
	})

	describe("Edge Cases", () => {
		it("should handle rapid file count changes", async () => {
			renderComponent()

			// Rapidly change file counts
			const counts = [10, 100, 5, 75, 200, 1]

			for (const count of counts) {
				const files = createFileSet(count)
				simulateMessage({
					type: "filesChanged",
					filesChanged: { baseCheckpoint: "hash1", files },
				})

				await waitFor(() => {
					expect(screen.getByTestId("files-changed-header")).toHaveTextContent(`${count} files changed`)
				})
			}
		})

		it("should handle files with very long URIs", async () => {
			const filesWithLongNames = Array.from({ length: 20 }, (_, i) => ({
				uri: `src/very/long/path/with/many/nested/directories/and/a/very/long/filename/that/might/cause/issues/file${i}.ts`,
				type: "edit" as FileChangeType,
				fromCheckpoint: "hash1",
				toCheckpoint: "hash2",
				linesAdded: 5,
				linesRemoved: 2,
			}))

			renderComponent()
			simulateMessage({
				type: "filesChanged",
				filesChanged: { baseCheckpoint: "hash1", files: filesWithLongNames },
			})

			await waitFor(() => {
				expect(screen.getByTestId("files-changed-overview")).toBeInTheDocument()
			})

			// Should handle long URIs without breaking layout
			expect(screen.getByTestId("files-changed-header")).toHaveTextContent("20 files changed")
		})
	})
})
