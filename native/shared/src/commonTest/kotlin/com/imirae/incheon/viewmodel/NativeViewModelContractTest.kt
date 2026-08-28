package com.imirae.incheon.viewmodel

import com.imirae.incheon.data.remote.ClientService
import com.imirae.incheon.data.remote.DocumentService
import com.imirae.incheon.data.remote.UpdateDocumentRequest
import com.imirae.incheon.data.remote.EmployeeService
import com.imirae.incheon.domain.models.Client
import com.imirae.incheon.domain.models.ClientListResponse
import com.imirae.incheon.domain.models.CreateClientRequest
import com.imirae.incheon.domain.models.Employee
import com.imirae.incheon.domain.models.FileItem
import com.imirae.incheon.domain.models.UpdateEmployeeRequest
import com.imirae.incheon.domain.models.UpdateClientRequest
import com.imirae.incheon.network.ApiError
import com.imirae.incheon.network.ApiResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class NativeViewModelContractTest {
    @Test
    fun clientListReportsCanonicalDataAndLoadingTransition() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        try {
            val service = RecordingClientService(
                clientsResult = ApiResult.Success(
                    ClientListResponse(
                        data = listOf(Client(id = 7, name = "홍길동", serviceStatus = "active")),
                        total = 1,
                        page = 1,
                        limit = 20,
                    ),
                ),
            )
            val viewModel = ClientListViewModel(service)

            viewModel.loadClients()
            assertTrue(viewModel.uiState.value.isLoading)
            advanceUntilIdle()

            assertFalse(viewModel.uiState.value.isLoading)
            assertEquals(listOf(7), viewModel.uiState.value.filteredClients.map { it.id })
            assertEquals(1, service.getClientsCalls)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun clientListReportsBackendErrorsWithoutFabricatingRows() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        try {
            val viewModel = ClientListViewModel(
                RecordingClientService(
                    clientsResult = ApiResult.Error(ApiError.Http(500, "server")),
                ),
            )

            viewModel.loadClients()
            advanceUntilIdle()

            assertFalse(viewModel.uiState.value.isLoading)
            assertTrue(viewModel.uiState.value.filteredClients.isEmpty())
            assertEquals("서버 오류가 발생했습니다 (500)", viewModel.uiState.value.error)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun employeeListUsesNumericIdsAndReportsErrorState() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        try {
            val service = RecordingEmployeeService(
                employeesResult = ApiResult.Success(
                    listOf(
                        Employee(
                            id = 3,
                            name = "김직원",
                            workArea = listOf("강남"),
                            phone = "010-0000-0000",
                            grade = "간호사",
                            openToNextWork = true,
                            status = "available",
                        ),
                    ),
                ),
            )
            val viewModel = EmployeeListViewModel(service)

            viewModel.loadEmployees()
            advanceUntilIdle()

            assertEquals(listOf(3), viewModel.uiState.value.filteredEmployees.map { it.id })
            assertEquals(1, viewModel.uiState.value.totalCount)
            assertEquals(1, viewModel.uiState.value.currentPage)
            assertEquals(1, viewModel.uiState.value.totalPages)

            service.employeesResult = ApiResult.Error(ApiError.Http(403, "forbidden"))
            viewModel.refresh()
            advanceUntilIdle()
            assertEquals("접근 권한이 없습니다", viewModel.uiState.value.error)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun employeeDetailLoadsUpdatesAndDeletesCanonicalEmployee() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        try {
            val employee = Employee(
                id = 3,
                name = "김직원",
                workArea = listOf("강남"),
                phone = "010-0000-0000",
                grade = "간호사",
                openToNextWork = true,
                status = "available",
            )
            val service = RecordingEmployeeService(ApiResult.Success(listOf(employee)))
            service.employeeResult = ApiResult.Success(employee)
            val viewModel = EmployeeDetailViewModel(service)

            viewModel.loadEmployee(3)
            advanceUntilIdle()
            assertEquals(3, viewModel.uiState.value.employee?.id)

            val updated = employee.copy(name = "김수정", openToNextWork = false)
            service.employeeResult = ApiResult.Success(updated)
            viewModel.updateEmployee(
                3,
                UpdateEmployeeRequest(name = updated.name, openToNextWork = updated.openToNextWork),
            )
            advanceUntilIdle()
            assertEquals("김수정", viewModel.uiState.value.employee?.name)
            assertEquals(listOf(3), service.updatedIds)

            viewModel.deleteEmployee(3)
            advanceUntilIdle()
            assertTrue(viewModel.uiState.value.deleteSuccess)
            assertEquals(listOf(3), service.deletedIds)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun contractViewModelLoadsCanonicalDocumentsAndSupportsDelete() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        try {
            val document = FileItem(
                id = "document-1",
                name = "계약서.pdf",
                categoryId = "contracts",
                mimeType = "application/pdf",
                fileSize = 12,
                storagePath = "documents/document-1.pdf",
                uploadedBy = "user-1",
                visibilityScope = "branch",
                canManage = true,
            )
            val service = RecordingDocumentService(ApiResult.Success(listOf(document)))
            val viewModel = ContractListViewModel(service)

            viewModel.loadContracts()
            assertTrue(viewModel.uiState.value.isLoading)
            advanceUntilIdle()

            assertFalse(viewModel.uiState.value.isLoading)
            assertEquals(listOf("document-1"), viewModel.uiState.value.documents.map { it.id })
            assertEquals(1, service.getDocumentsCalls)

            val updatedDocument = document.copy(name = "계약서-수정.pdf")
            service.documentResult = ApiResult.Success(updatedDocument)
            viewModel.loadContract("document-1")
            advanceUntilIdle()
            assertEquals("document-1", viewModel.uiState.value.selectedDocument?.id)

            viewModel.updateContract("document-1", UpdateDocumentRequest(name = updatedDocument.name))
            advanceUntilIdle()
            assertEquals("계약서-수정.pdf", viewModel.uiState.value.selectedDocument?.name)
            assertEquals(listOf("document-1"), service.updatedIds)

            viewModel.loadContract("")
            assertEquals("계약 문서 식별자가 올바르지 않습니다.", viewModel.uiState.value.detailError)
            assertEquals(1, service.getDocumentCalls)

            viewModel.deleteContract("document-1")
            advanceUntilIdle()
            assertTrue(viewModel.uiState.value.documents.isEmpty())
            assertEquals(listOf("document-1"), service.deletedIds)
        } finally {
            Dispatchers.resetMain()
        }
    }

    @Test
    fun contractCreateIsExplicitlyUnsupportedWithoutInventingRoute() {
        val viewModel = ContractListViewModel(RecordingDocumentService(ApiResult.Success(emptyList())))
        val result = viewModel.createContract()
        assertFalse(viewModel.uiState.value.isCreating)
        var isUnsupported = false
        result.onError { isUnsupported = it is ApiError.Unsupported }
        assertTrue(isUnsupported)
    }

    private class RecordingClientService(
        var clientsResult: ApiResult<ClientListResponse>,
    ) : ClientService {
        var getClientsCalls = 0

        override suspend fun getClients(page: Int, limit: Int, search: String?): ApiResult<ClientListResponse> {
            getClientsCalls += 1
            return clientsResult
        }

        override suspend fun getClient(id: Int): ApiResult<Client> = ApiResult.Error(ApiError.Unsupported("unused"))
        override suspend fun createClient(request: CreateClientRequest): ApiResult<Client> = ApiResult.Error(ApiError.Unsupported("unused"))
        override suspend fun updateClient(id: Int, request: UpdateClientRequest): ApiResult<Client> = ApiResult.Error(ApiError.Unsupported("unused"))
        override suspend fun deleteClient(id: Int): ApiResult<Unit> = ApiResult.Error(ApiError.Unsupported("unused"))
    }

    private class RecordingEmployeeService(
        var employeesResult: ApiResult<List<Employee>>,
    ) : EmployeeService {
        var employeeResult: ApiResult<Employee> = ApiResult.Error(ApiError.Unsupported("unused"))
        val updatedIds = mutableListOf<Int>()
        val deletedIds = mutableListOf<Int>()

        override suspend fun getEmployees(search: String?): ApiResult<List<Employee>> = employeesResult
        override suspend fun getEmployee(id: Int): ApiResult<Employee> = employeeResult
        override suspend fun updateEmployee(id: Int, request: UpdateEmployeeRequest): ApiResult<Employee> {
            updatedIds += id
            return employeeResult
        }
        override suspend fun deleteEmployee(id: Int): ApiResult<Unit> {
            deletedIds += id
            return ApiResult.Success(Unit)
        }
    }

    private class RecordingDocumentService(
        var documentsResult: ApiResult<List<FileItem>>,
        var documentResult: ApiResult<FileItem> = ApiResult.Error(ApiError.Unsupported("unused")),
    ) : DocumentService {
        var getDocumentsCalls = 0
        var getDocumentCalls = 0
        val deletedIds = mutableListOf<String>()
        val updatedIds = mutableListOf<String>()

        override suspend fun getDocuments(categoryId: String?): ApiResult<List<FileItem>> {
            getDocumentsCalls += 1
            return documentsResult
        }

        override suspend fun getDocument(id: String): ApiResult<FileItem> {
            getDocumentCalls += 1
            return documentResult
        }

        override suspend fun updateDocument(id: String, request: UpdateDocumentRequest): ApiResult<FileItem> {
            updatedIds += id
            return documentResult
        }

        override suspend fun deleteDocument(id: String): ApiResult<Unit> {
            deletedIds += id
            return ApiResult.Success(Unit)
        }
    }
}
