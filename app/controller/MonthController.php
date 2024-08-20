<?php

namespace app\controller;

use app\service\MonthService;
use app\dto\MonthDto;

class MonthController
{
    private MonthService $monthService;
    public function __construct()
    {
        $this->monthService = new MonthService();
    }

    public function selectAll()
    {
        $this->monthService->selectAll();
    }

    public function selectById($request)
    {
        $monthDto = new MonthDto();
        $monthDto->id = $request["id"];
        return $this->monthService->selectById($monthDto);
    }
    
    public function selectByName($request)
    {
        $monthDto = new MonthDto();
        $monthDto->id = $request["name"];
        return $this->monthService->selectByName($monthDto);
    }

    public function selectByDay($request)
    {
        $monthDto = new MonthDto();
        $monthDto->id = $request["day"];
        return $this->monthService->selectByDay($monthDto);
    }

    public function selectByMonth($request)
    {
        $monthDto = new MonthDto();
        $monthDto->id = $request["month"];
        return $this->monthService->selectByMonth($monthDto);
    }

    public function selectByYear($request)
    {
        $monthDto = new MonthDto();
        $monthDto->id = $request["year"];
        return $this->monthService->selectByYear($monthDto);
    }

    public function insert($request)
    {
        $monthDto = new MonthDto();
        $monthDto->id = $request["id"];
        $monthDto->name = $request["name"];
        $monthDto->day= $request["day"];
        $monthDto->month = $request["month"];
        $monthDto->year = $request["year"];
        $this->monthService->insert($monthDto);
    }

    public function update($request)
    {
        $monthDto = new MonthDto();
        $monthDto->id = $request["newId"];
        $monthDto->name = $request["newName"];
        $monthDto->day= $request["newDay"];
        $monthDto->month = $request["newMonth"];
        $monthDto->year = $request["newYear"];
        $this->monthService->update($monthDto);
    }

    public function delete($request)
    {
        $monthDto = new MonthDto();
        $monthDto->id = $request["id"];
        $this->monthService->delete($monthDto);
    }
}
