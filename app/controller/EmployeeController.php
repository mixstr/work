<?php

namespace app\controller;

use app\service\EmployeeService;
use app\dto\EmployeeDto;

class EmployeeController
{
    private EmployeeService $employeeService;
    public function __construct()
    {
        $this->employeeService = new EmployeeService();
    }

    public function selectAll()
    {
        $this->employeeService->selectAll();
    }

    public function selectById($request)
    {
        $employeeDto = new EmployeeDto();
        $employeeDto->id = $request["id"];
        return $this->employeeService->selectById($employeeDto);
    }
    
    public function selectByFio($request)
    {
        $employeeDto = new EmployeeDto();
        $employeeDto->fio = $request["fio"];
        return $this->employeeService->selectByFio($employeeDto);
    }
    
    public function selectByHire($request)
    {
        $employeeDto = new EmployeeDto();
        $employeeDto->hire_date = $request["hire_date"];
        return $this->employeeService->selectByHire($employeeDto);
    }

    public function selectByTermination($request)
    {
        $employeeDto = new EmployeeDto();
        $employeeDto->termination_date = $request["termination_date"];
        return $this->employeeService->selectByTermination($employeeDto);
    }

    public function insert($request)
    {
        $employeeDto = new EmployeeDto();
        $employeeDto->id = $request["id"];
        $employeeDto->fio = $request["fio"];
        $employeeDto->hire_date = $request["hire_date"];
        $employeeDto->termination_date = $request["termination_date"];
        $this->employeeService->insert($employeeDto);
    }

    public function update($request)
    {
        $employeeDto = new EmployeeDto();
        $employeeDto->id = $request["newId"];
        $employeeDto->fio = $request["newFio"];
        $employeeDto->hire_date = $request["newHire_date"];
        $employeeDto->termination_date = $request["newTermination_date"];
        $this->employeeService->update($employeeDto);
    }

    public function delete($request)
    {
        $employeeDto = new EmployeeDto();
        $employeeDto->id = $request["id"];
        $this->employeeService->delete($employeeDto);
    }
}
