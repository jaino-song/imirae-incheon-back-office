package com.imirae.incheon.data.remote
import com.imirae.incheon.domain.models.*
import com.imirae.incheon.network.*
import io.ktor.client.request.setBody

interface EmployeeService {
    suspend fun getEmployees(search: String? = null): ApiResult<List<Employee>>
    suspend fun getEmployee(id: Int): ApiResult<Employee>
    suspend fun updateEmployee(id: Int, request: UpdateEmployeeRequest): ApiResult<Employee>
    suspend fun deleteEmployee(id: Int): ApiResult<Unit>
}

class EmployeeServiceImpl(private val client: ApiClient) : EmployeeService {
    override suspend fun getEmployees(search: String?) = client.get<List<Employee>>("/employees" + (search?.let { "?search=$it" } ?: ""))
    override suspend fun getEmployee(id: Int) = client.get<Employee>("/employees/id?id=$id")
    override suspend fun updateEmployee(id: Int, request: UpdateEmployeeRequest) =
        client.patch<Employee>("/employees?id=$id") { setBody(request) }

    override suspend fun deleteEmployee(id: Int) = client.delete<Unit>("/employees?id=$id")
}
