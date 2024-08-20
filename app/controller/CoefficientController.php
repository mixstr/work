<?php

namespace app\controller;

use app\service\CoefficientService;
use app\dto\CoefficientDto;

class CoefficientController
{
    private CoefficientService $coefficientService;
    public function __construct()
    {
        $this->coefficientService = new CoefficientService();
    }

    public function selectAll()
    {
        $this->coefficientService->selectAll();
    }

    public function selectById($id)
    {
        $this->coefficientService->selectById($id);
    }
    
    public function selectByEmployee($employee_id)
    {
        $this->coefficientService->selectByEmployee($employee_id);
    }
    
    public function selectByMonth($month_id)
    {
        $this->coefficientService->selectByMonth($month_id);
    }

    public function insert($request)
    {
        $coefficientDto = new CoefficientDto();
        $coefficientDto->id = $request["id"];
        $coefficientDto->employee_id = $request["employee_id"];
        $coefficientDto->month_id = $request["month_id"];
        $coefficientDto->coefficient = $request["coefficient"];
        $this->coefficientService->insert($coefficientDto);
    }

    public function update($request)
    {
        $coefficientDto = new CoefficientDto();
        $coefficientDto->id = $request["id"];
        $coefficientDto->employee_id = $request["employee_id"];
        $coefficientDto->month_id = $request["month_id"];
        $coefficientDto->coefficient = $request["coefficient"];
        $this->coefficientService->update($coefficientDto);
    }

    public function delete($request)
    {
        $coefficientDto = new CoefficientDto();
        $coefficientDto->id = $request["id"];
        $this->coefficientService->delete($coefficientDto);
    }
}
